"""One-off script to generate a realistic (non-anime) Lily portrait using
Nano Banana (Gemini image gen) and save it to the frontend public folder.

Run once from the backend venv:
    python /app/backend/scripts/generate_lily_portrait.py
"""
import asyncio
import base64
import os
import sys

from dotenv import load_dotenv


async def main() -> int:
    load_dotenv("/app/backend/.env")
    api_key = os.getenv("EMERGENT_LLM_KEY")
    if not api_key:
        print("ERROR: EMERGENT_LLM_KEY missing from /app/backend/.env")
        return 1

    from emergentintegrations.llm.chat import LlmChat, UserMessage

    chat = LlmChat(
        api_key=api_key,
        session_id="lily-portrait-gen",
        system_message="You are a friendly professional portrait generator.",
    )
    chat.with_model("gemini", "gemini-3.1-flash-image-preview").with_params(
        modalities=["image", "text"],
    )

    prompt = (
        "A friendly, spherical robot mascot rendered in a high-end 3D digital art "
        "style, front-facing head-and-shoulders composition. Main body is a perfect "
        "sphere with a matte deep-charcoal / near-black finish (#1A1A1A). "
        "Intricate glowing ELECTRIC CYAN circuit-board patterns (#00FFFF) are "
        "etched across its surface, wrapping symmetrically around the face plate. "
        "TWO LARGE ROUND WIDE-SET EYES: bright cyan glowing outer ring (#00FFFF), "
        "vibrant blue iris (#0099CC), small dark pupils centered — expressive and "
        "friendly, looking straight at the camera. MOUTH is a distinct glowing "
        "electric blue SINE-WAVE / WAVEFORM (#00FFFF), symmetric, smooth outline, "
        "conveying cheerful speech. Two thin cylindrical antennas rise from the "
        "top of the head, each ending in a small glowing cyan orb. Two short "
        "segmented arms with three-fingered hands extend from the sides. "
        "The robot stands on a stylized luminous blue SPEECH-BUBBLE base (#00FFFF). "
        "Background: dark navy-blue out-of-focus digital blur with subtle light "
        "trails and grid particles. Lighting is dominated by the internal cyan "
        "glow of the mascot itself, creating an atmospheric neon cyberpunk mood "
        "that feels futuristic yet warm and inviting. NOT anime, NOT a human. "
        "Sharp centered symmetric composition, 1:1 square aspect ratio, 4K quality."
    )

    print("Generating portrait…")
    _text, images = await chat.send_message_multimodal_response(UserMessage(text=prompt))

    if not images:
        print("ERROR: no images returned from Nano Banana")
        return 2

    out_path = "/app/frontend/public/lily_robot.png"
    image_bytes = base64.b64decode(images[0]["data"])
    with open(out_path, "wb") as f:
        f.write(image_bytes)
    print(f"Saved {len(image_bytes)} bytes → {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
