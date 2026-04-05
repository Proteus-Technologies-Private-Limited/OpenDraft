"""
Generate Google Play Store feature graphic (1024x500) for OpenDraft.
Uses the app logo + editor screenshot with brand gradient background.
"""

from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "test-script", "output")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Dimensions
W, H = 1024, 500

# Brand colors
PURPLE = (134, 59, 255)
DEEP_PURPLE = (90, 20, 180)
DARK_BG = (18, 10, 40)
CYAN = (71, 191, 255)
LIGHT_LAVENDER = (237, 230, 255)
WHITE = (255, 255, 255)

# --- Create the canvas with gradient ---
img = Image.new("RGBA", (W, H), DARK_BG)

# Horizontal gradient
gradient = Image.new("RGBA", (W, H))
gradient_draw = ImageDraw.Draw(gradient)
for x in range(W):
    t = x / W
    r = int(18 + (70 - 18) * t)
    g = int(10 + (15 - 10) * t)
    b = int(40 + (110 - 40) * t)
    gradient_draw.line([(x, 0), (x, H)], fill=(r, g, b, 255))
img = Image.alpha_composite(img, gradient)

# --- Add subtle decorative glows ---
overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
overlay_draw = ImageDraw.Draw(overlay)

# Large purple glow - center-left
for r in range(250, 0, -1):
    alpha = int(18 * (1 - r / 250))
    overlay_draw.ellipse(
        [300 - r, 250 - r, 300 + r, 250 + r],
        fill=(134, 59, 255, alpha)
    )

# Cyan glow - top right
for r in range(180, 0, -1):
    alpha = int(14 * (1 - r / 180))
    overlay_draw.ellipse(
        [820 - r, 80 - r, 820 + r, 80 + r],
        fill=(71, 191, 255, alpha)
    )

# Purple glow - bottom right
for r in range(120, 0, -1):
    alpha = int(10 * (1 - r / 120))
    overlay_draw.ellipse(
        [900 - r, 450 - r, 900 + r, 450 + r],
        fill=(134, 59, 255, alpha)
    )

img = Image.alpha_composite(img, overlay)

# --- Place editor screenshot on the RIGHT with tilt effect ---
editor_path = os.path.join(PROJECT_ROOT, "images", "editor.png")
editor = Image.open(editor_path).convert("RGBA")

# Resize editor
editor_w = 500
editor_h = int(editor.height * editor_w / editor.width)
editor = editor.resize((editor_w, editor_h), Image.LANCZOS)

# Crop top portion
crop_h = 380
editor = editor.crop((0, 0, editor_w, min(crop_h, editor_h)))

# Add rounded corners
corner_radius = 14
rounded_mask = Image.new("L", editor.size, 0)
rounded_draw = ImageDraw.Draw(rounded_mask)
rounded_draw.rounded_rectangle(
    [0, 0, editor.size[0], editor.size[1]],
    radius=corner_radius, fill=255
)

# Apply mask
editor_masked = Image.new("RGBA", editor.size, (0, 0, 0, 0))
editor_masked.paste(editor, (0, 0), rounded_mask)

# Slight rotation for visual interest
editor_rotated = editor_masked.rotate(-3, expand=True, resample=Image.BICUBIC)

# Create shadow
shadow_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
editor_x = 530
editor_y = 40

# Dark shadow behind editor
shadow_img = Image.new("RGBA", editor_rotated.size, (0, 0, 0, 90))
shadow_mask = editor_rotated.split()[3]
shadow_final = Image.new("RGBA", editor_rotated.size, (0, 0, 0, 0))
shadow_final.paste(shadow_img, (0, 0), shadow_mask)
shadow_layer.paste(shadow_final, (editor_x + 10, editor_y + 10), shadow_final)
shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(radius=15))
img = Image.alpha_composite(img, shadow_layer)

# Purple border glow
glow_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
glow_img = Image.new("RGBA", editor_rotated.size, (134, 59, 255, 50))
glow_final = Image.new("RGBA", editor_rotated.size, (0, 0, 0, 0))
glow_final.paste(glow_img, (0, 0), shadow_mask)
glow_layer.paste(glow_final, (editor_x - 3, editor_y - 3), glow_final)
glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(radius=5))
img = Image.alpha_composite(img, glow_layer)

# Paste editor
img.paste(editor_rotated, (editor_x, editor_y), editor_rotated)

# --- Place app logo on LEFT ---
logo_path = os.path.join(PROJECT_ROOT, "images", "OpenDraft-1024x1024.png")
logo = Image.open(logo_path).convert("RGBA")

logo_size = 180
logo = logo.resize((logo_size, logo_size), Image.LANCZOS)

# Circular mask
mask = Image.new("L", (logo_size, logo_size), 0)
mask_draw = ImageDraw.Draw(mask)
mask_draw.ellipse([0, 0, logo_size, logo_size], fill=255)

# Glow ring behind logo
draw = ImageDraw.Draw(img)
logo_x = 55
logo_y = 80
cx = logo_x + logo_size // 2
cy = logo_y + logo_size // 2

glow2 = Image.new("RGBA", (W, H), (0, 0, 0, 0))
glow2_draw = ImageDraw.Draw(glow2)
for r in range(logo_size // 2 + 25, logo_size // 2, -1):
    alpha = int(50 * (1 - (r - logo_size // 2) / 25))
    glow2_draw.ellipse([cx - r, cy - r, cx + r, cy + r],
                       fill=(134, 59, 255, alpha))
img = Image.alpha_composite(img, glow2)

# Paste circular logo
logo_circ = Image.new("RGBA", (logo_size, logo_size), (0, 0, 0, 0))
logo_circ.paste(logo, (0, 0), mask)
img.paste(logo_circ, (logo_x, logo_y), logo_circ)
draw = ImageDraw.Draw(img)

# --- Typography ---
# Find available fonts
font_candidates = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Arial.ttf",
]

regular_candidates = [
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/Library/Fonts/Arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
]

def find_font(candidates, size):
    for fp in candidates:
        if os.path.exists(fp):
            try:
                return ImageFont.truetype(fp, size)
            except Exception:
                continue
    return ImageFont.load_default()

title_font = find_font(font_candidates, 56)
tagline_font = find_font(regular_candidates, 22)
sub_font = find_font(regular_candidates, 16)
badge_font = find_font(regular_candidates, 13)

# Layout: text left-aligned, starting after the logo
text_left = 260
center_y = 145

# "OpenDraft" title
open_bbox = draw.textbbox((0, 0), "Open", font=title_font)
open_w = open_bbox[2] - open_bbox[0]
draft_bbox = draw.textbbox((0, 0), "Draft", font=title_font)
draft_w = draft_bbox[2] - draft_bbox[0]

draw.text((text_left, center_y), "Open", fill=WHITE, font=title_font)
draw.text((text_left + open_w + 2, center_y), "Draft", fill=CYAN, font=title_font)

# Tagline
draw.text((text_left, center_y + 66), "Professional Screenwriting", fill=(210, 210, 225), font=tagline_font)

# Sub-tagline
draw.text((text_left, center_y + 96), "Free & Open Source", fill=(160, 160, 180), font=sub_font)

# --- Feature badges ---
badges = ["PDF Export", "Real-Time Collab", "Beat Board", "Index Cards"]
badge_y = 340
badge_x = 65

for i, badge_text in enumerate(badges):
    bx = badge_x + i * 120
    bbox = draw.textbbox((0, 0), badge_text, font=badge_font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    pill_w = tw + 24
    pill_h = 30

    # Pill background
    pill_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    pill_draw = ImageDraw.Draw(pill_layer)
    pill_draw.rounded_rectangle(
        [bx, badge_y, bx + pill_w, badge_y + pill_h],
        radius=15,
        fill=(134, 59, 255, 50),
        outline=(134, 59, 255, 130),
        width=1
    )
    img = Image.alpha_composite(img, pill_layer)
    draw = ImageDraw.Draw(img)

    # Badge text
    draw.text(
        (bx + pill_w // 2, badge_y + pill_h // 2),
        badge_text, fill=LIGHT_LAVENDER, font=badge_font, anchor="mm"
    )

# --- Decorative line/accent ---
# Thin gradient line under title area
line_y = center_y + 125
for x in range(text_left, text_left + 220):
    t = (x - text_left) / 220
    alpha = int(180 * (1 - t))
    r = int(PURPLE[0] * (1 - t) + CYAN[0] * t)
    g = int(PURPLE[1] * (1 - t) + CYAN[1] * t)
    b = int(PURPLE[2] * (1 - t) + CYAN[2] * t)
    draw.line([(x, line_y), (x, line_y + 2)], fill=(r, g, b, alpha))

# --- Bottom tagline ---
draw.text(
    (W // 2, H - 30),
    "Write screenplays like the pros — without the price tag",
    fill=(130, 130, 150), font=badge_font, anchor="mm"
)

# --- Save ---
final = Image.new("RGB", (W, H), (0, 0, 0))
final.paste(img, (0, 0), img)

output_path = os.path.join(OUTPUT_DIR, "feature_graphic_1024x500.png")
final.save(output_path, "PNG", quality=95)
print(f"Feature graphic saved to: {output_path}")
print(f"Size: {final.size}")
