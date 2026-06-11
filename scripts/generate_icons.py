"""Generate MeetScribe PNG icons."""
from PIL import Image, ImageDraw, ImageFont
import os

SIZES = [16, 48, 128]
COLOR_BG = "#1a1a2e"
COLOR_ACCENT = "#e94560"

def generate_icon(size, output_path):
    img = Image.new("RGBA", (size, size), COLOR_BG)
    draw = ImageDraw.Draw(img)
    cx, cy = size // 2, size // 2
    r = size * 0.3
    rh = size * 0.4
    mic_top = cy - rh // 2
    mic_bottom = cy + rh // 2
    mic_left = cx - r
    mic_right = cx + r

    # Mic body
    draw.ellipse([mic_left, mic_top, mic_right, mic_bottom], fill=COLOR_ACCENT)

    # Stand
    stand_top = mic_bottom
    stand_bottom = cy + rh // 2 + size * 0.15
    draw.rectangle([cx - max(1,size//24), stand_top, cx + max(1,size//24), stand_bottom], fill=COLOR_ACCENT)

    # Base arc
    base_y = stand_bottom
    bl = cx - size * 0.15
    br = cx + size * 0.15
    draw.arc([bl, base_y - size * 0.05, br, base_y + size * 0.05], 0, 180, fill=COLOR_ACCENT, width=max(1, size // 16))

    img.save(output_path, "PNG")
    print("  OK " + output_path + " (" + str(size) + "x" + str(size) + ")")

if __name__ == "__main__":
    output_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "public")
    os.makedirs(output_dir, exist_ok=True)
    for s in SIZES:
        generate_icon(s, os.path.join(output_dir, "icon" + str(s) + ".png"))
    print("Done!")
