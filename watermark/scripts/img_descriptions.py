import argparse
from pathlib import Path
from PIL import Image
import humanize

parser = argparse.ArgumentParser(description="Generate image descriptions for a folder of images.")
parser.add_argument("-i", "--input", required=True, type=Path, help="Input folder containing images.")
args = parser.parse_args()

input_dir = args.input
print("input_dir: ", input_dir)
if not input_dir.exists() or not input_dir.is_dir():
    print(f"Input folder does not exist or is not a directory: {input_dir}")
    exit(1)

for file in input_dir.glob("*.png"):
    # print name, filesize and image dimensions
    human_readable_size = humanize.naturalsize(file.stat().st_size)
    print(f"Filename: {file.name} - Size: {human_readable_size} - Dimensions: {Image.open(file).width}x{Image.open(file).height}")