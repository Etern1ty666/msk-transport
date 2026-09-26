import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATASET_DIR = Path(os.getenv("DATASET_DIR", ROOT.parent / "dataset"))
DATA_DIR = Path(os.getenv("DATA_DIR", ROOT / "data"))
