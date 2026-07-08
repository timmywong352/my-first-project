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
        "Cute friendly robot mascot character named Lily, head-and-shoulders portrait, "
        "front-facing symmetrical pose. Rounded polished chassis in soft ROYAL BLUE with "
        "white and silver accents, slightly glossy plastic-like finish. "
        "TWO clearly visible large round glowing EYE LIGHTS in a lighter cyan-blue, "
        "positioned symmetrically like eyes on the face plate. "
        "A small horizontal mouth panel BELOW the eyes — a thin, gentle upward-curved "
        "smile shape (mouth CLOSED, no teeth), also glowing softly. "
        "Cute, approachable, non-threatening — inspired by BB-8 / Wall-E / EVE from "
        "Pixar. NOT anime, NOT a human face, NOT scary or industrial. "
        "Simple antenna or small LED accents on top of the head. "
        "The robot should look like a professional-yet-friendly customer support "
        "assistant. Very subtle pink-to-blue gradient studio background. "
        "3D-rendered but stylized / mascot art style — clean edges, soft shadows. "
        "Sharp centered composition, 1:1 square aspect ratio, high quality 4K detail."
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
