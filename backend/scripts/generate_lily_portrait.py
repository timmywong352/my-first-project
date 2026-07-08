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
        "Photorealistic head-and-shoulders portrait of a friendly female customer "
        "support representative named Lily, approximately 27 years old. "
        "Warm, approachable smile with mouth CLOSED (lips together, subtle upturn). "
        "Straight-on symmetrical pose facing camera. "
        "Medium-length wavy dark brown hair falling naturally on shoulders. "
        "Wearing a professional royal-blue blazer over a crisp white shirt. "
        "Soft studio lighting with a very subtle pink-blue gradient background. "
        "Clean corporate headshot style. Realistic skin texture, natural makeup. "
        "3D-rendered look but photorealistic — like a modern digital human, "
        "NOT an anime character, NOT a cartoon. Sharp focus on the eyes. "
        "Square 1:1 aspect ratio composition. High quality, 4K detail."
    )

    print("Generating portrait…")
    _text, images = await chat.send_message_multimodal_response(UserMessage(text=prompt))

    if not images:
        print("ERROR: no images returned from Nano Banana")
        return 2

    out_path = "/app/frontend/public/lily_realistic.png"
    image_bytes = base64.b64decode(images[0]["data"])
    with open(out_path, "wb") as f:
        f.write(image_bytes)
    print(f"Saved {len(image_bytes)} bytes → {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
