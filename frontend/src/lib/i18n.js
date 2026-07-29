// Simple i18n for the customer chat widget.
// Keep the string count small — this is meant for the widget UI only,
// not the whole app. Lily's greetings come from the backend already.

export const SUPPORTED_LANGS = [
  { code: "en", label: "English", flag: "🇺🇸" },
  { code: "ms", label: "Bahasa Malaysia", flag: "🇲🇾" },
  { code: "zh", label: "中文", flag: "🇨🇳" },
];

const STRINGS = {
  en: {
    header_title: "Lily · Support",
    header_status: "Live agent",
    close_chat: "Close chat",
    close_confirm_title: "Close this chat?",
    close_confirm_body: "You'll end this conversation and any pending replies won't be delivered.",
    close_confirm_yes: "Yes, close",
    close_confirm_no: "Not yet",
    launcher_text: "Chat with us",
    input_placeholder: "Type your message…",
    input_placeholder_lily: "Ask Lily anything…",
    send: "Send",
    upload_file: "Upload file",
    take_photo: "Take photo",
    thanks_rating: "Thanks for rating us!",
    rate_prompt: "How would you rate this chat?",
    queued_title: "You're in the queue",
    queued_desc: "An agent will be with you shortly.",
    typing: "typing…",
    lily_click_hint: "Click me to say hi again 👋",
    reconnecting: "Reconnecting…",
    sound_on: "Sounds on",
    sound_off: "Sounds off",
    voice_on: "Voice on",
    voice_off: "Voice muted",
    language: "Language",
    restart: "Start over",
    restart_confirm_title: "Leave this chat and start over?",
    restart_confirm_body: "You'll leave the current conversation with our team. Your session history stays in our records but you'll return to the welcome screen.",
    restart_confirm_yes: "Yes, start over",
    restart_confirm_no: "Stay here",
  },
  ms: {
    header_title: "Lily · Sokongan",
    header_status: "Ejen langsung",
    close_chat: "Tutup sembang",
    close_confirm_title: "Tutup sembang ini?",
    close_confirm_body: "Anda akan menamatkan perbualan ini dan balasan yang belum dihantar tidak akan sampai.",
    close_confirm_yes: "Ya, tutup",
    close_confirm_no: "Belum lagi",
    launcher_text: "Sembang dengan kami",
    input_placeholder: "Taip mesej anda…",
    input_placeholder_lily: "Tanya Lily apa sahaja…",
    send: "Hantar",
    upload_file: "Muat naik fail",
    take_photo: "Ambil gambar",
    thanks_rating: "Terima kasih atas penilaian!",
    rate_prompt: "Bagaimana penilaian anda untuk sembang ini?",
    queued_title: "Anda dalam giliran",
    queued_desc: "Ejen akan bersama anda tidak lama lagi.",
    typing: "sedang menaip…",
    lily_click_hint: "Klik saya untuk sapaan lain 👋",
    reconnecting: "Menyambung semula…",
    sound_on: "Bunyi dihidupkan",
    sound_off: "Bunyi dimatikan",
    voice_on: "Suara dihidupkan",
    voice_off: "Suara disenyapkan",
    language: "Bahasa",
    restart: "Mula semula",
    restart_confirm_title: "Tinggalkan sembang ini dan mula semula?",
    restart_confirm_body: "Anda akan meninggalkan perbualan semasa dengan pasukan kami. Sejarah sesi disimpan dalam rekod kami tetapi anda akan kembali ke skrin alu-aluan.",
    restart_confirm_yes: "Ya, mula semula",
    restart_confirm_no: "Kekal di sini",
  },
  zh: {
    header_title: "Lily · 客服",
    header_status: "在线客服",
    close_chat: "结束对话",
    close_confirm_title: "结束此对话？",
    close_confirm_body: "您将结束此对话，未发送的回复将不会送达。",
    close_confirm_yes: "确定结束",
    close_confirm_no: "暂不",
    launcher_text: "在线咨询",
    input_placeholder: "输入消息…",
    input_placeholder_lily: "问 Lily 任何问题…",
    send: "发送",
    upload_file: "上传文件",
    take_photo: "拍照",
    thanks_rating: "感谢您的评价！",
    rate_prompt: "您对本次对话满意吗？",
    queued_title: "您正在排队中",
    queued_desc: "客服人员马上就到。",
    typing: "正在输入…",
    lily_click_hint: "点击我再打个招呼 👋",
    reconnecting: "正在重新连接…",
    sound_on: "提示音开启",
    sound_off: "提示音关闭",
    voice_on: "语音开启",
    voice_off: "语音关闭",
    language: "语言",
    restart: "重新开始",
    restart_confirm_title: "离开当前对话并重新开始？",
    restart_confirm_body: "您将离开与客服的当前对话。会话记录会保存在系统中，但会返回到欢迎界面。",
    restart_confirm_yes: "确定重新开始",
    restart_confirm_no: "留在此处",
  },
};

const LANG_KEY = "pulse_lang";

export function getInitialLang() {
  const saved = localStorage.getItem(LANG_KEY);
  if (saved && STRINGS[saved]) return saved;
  const browser = (navigator.language || "en").toLowerCase();
  if (browser.startsWith("zh")) return "zh";
  if (browser.startsWith("ms")) return "ms";
  return "en";
}

export function saveLang(code) {
  try { localStorage.setItem(LANG_KEY, code); } catch { /* ignore */ }
}

/** Return a translator function bound to a language code. */
export function tFactory(code) {
  const dict = STRINGS[code] || STRINGS.en;
  return (key) => dict[key] ?? STRINGS.en[key] ?? key;
}
