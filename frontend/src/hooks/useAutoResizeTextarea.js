import { useEffect, useRef, useCallback } from "react";

/**
 * Auto-resize textarea (grows with content up to maxHeight) and preserve
 * line-breaks when pasting rich text.
 *
 * Usage:
 *   const { ref, onPaste } = useAutoResizeTextarea(value, {
 *     minHeight: 40,
 *     maxHeight: 200,
 *     onChange: (nextValue) => setValue(nextValue), // needed for paste
 *   });
 *   <Textarea ref={ref} value={value} onChange={...} onPaste={onPaste} ... />
 *
 * Notes:
 *  - `value` in deps re-triggers resize whenever content changes.
 *  - `onPaste` reads text/plain (preserves \n from source apps). If the paste
 *    source only has text/html (e.g. Word/Notion rich blocks), we convert
 *    common block/line elements to newlines and strip the rest.
 */
export function useAutoResizeTextarea(value, { minHeight = 40, maxHeight = 200, onChange } = {}) {
  const ref = useRef(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Reset so scrollHeight reflects only the content, not any previous set height.
    el.style.height = "auto";
    const next = Math.min(Math.max(el.scrollHeight, minHeight), maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [minHeight, maxHeight]);

  useEffect(() => {
    resize();
  }, [value, resize]);

  const onPaste = useCallback((e) => {
    if (!onChange) return; // caller opted-out of paste handling
    const cd = e.clipboardData;
    if (!cd) return;

    let pasted = cd.getData("text/plain");
    if (!pasted) {
      const html = cd.getData("text/html");
      if (html) {
        // Convert common block/line HTML into newlines so bullet lists and
        // paragraphs survive the trip from rich sources.
        const normalised = html
          .replace(/<\s*br\s*\/?>/gi, "\n")
          .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
          .replace(/<li[^>]*>/gi, "• ")
          .replace(/<[^>]+>/g, "")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");
        pasted = normalised;
      }
    }
    if (!pasted) return;

    e.preventDefault();
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + pasted + value.slice(end);
    onChange(next);
    // Place caret after the pasted chunk on next tick.
    requestAnimationFrame(() => {
      if (!ref.current) return;
      const pos = start + pasted.length;
      ref.current.selectionStart = pos;
      ref.current.selectionEnd = pos;
      resize();
    });
  }, [value, onChange, resize]);

  return { ref, onPaste, resize };
}
