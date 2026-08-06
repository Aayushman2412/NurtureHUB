import os
import sys
import time
import json
import re
import logging
import traceback
from pathlib import Path

# ==============================================================================
# PIPELINE CONFIGURATION & PATH SETUP
# ==============================================================================
# ADD-ON (NurtureHUB server): workspace root comes from the environment so each
# run executes in its own isolated working directory; the original Desktop path
# is kept as the fallback for local use. Revert by restoring the literal Path.
WORKSPACE_DIR = Path(os.environ.get(
    "PIPELINE_WORKSPACE_DIR",
    "C:/Users/AayushmanSingh/Desktop/full pipeline",
)).resolve()
INPUTS_DIR = WORKSPACE_DIR / "Inputs"
RAW_INPUT_PARENT = INPUTS_DIR / "input_folder"


def find_raw_input_dir():
    """The raw data lives in a dated subfolder inside Inputs/input_folder, e.g.
        input_folder_1107(CUD)_1707(DD)_Ujjain
    (date before (CUD) = current-upload date, date before (DD) = download date,
    trailing word = district/state). Pick the most recently modified dated
    subfolder; fall back to Inputs/input_folder itself if none exists.

    ADD-ON (NurtureHUB server): PIPELINE_RAW_INPUT_DIR names the folder
    explicitly, because copying an input store into a fresh run directory
    rewrites directory mtimes and would make the "newest" heuristic pick the
    wrong folder. Unset = original mtime behaviour."""
    forced = os.environ.get("PIPELINE_RAW_INPUT_DIR", "").strip()
    if forced:
        candidate = Path(forced)
        if candidate.is_dir():
            return candidate
        print(f"WARNING: PIPELINE_RAW_INPUT_DIR={forced} is not a directory — "
              "falling back to newest-folder detection.")
    if RAW_INPUT_PARENT.exists():
        subs = [d for d in RAW_INPUT_PARENT.iterdir()
                if d.is_dir() and "(CUD)" in d.name.upper()]
        if subs:
            return max(subs, key=lambda p: p.stat().st_mtime)
    return RAW_INPUT_PARENT


RAW_INPUT_DIR = find_raw_input_dir()
CLEANED_DIR = INPUTS_DIR / "cleaned"
COMBINED_DIR = INPUTS_DIR / "combined"
SUMMARIES_DIR = INPUTS_DIR / "summaries"
MASTER_DIR = INPUTS_DIR / "merged"
DERIVED_DIR = INPUTS_DIR / "derived"
OUTPUTS_DIR = WORKSPACE_DIR / "outputs"

# File Dependency Paths
ROLE_SHEET_FILE = INPUTS_DIR / "Role and department sheet.xlsx"
VALIDATION_REPORT_FILE = WORKSPACE_DIR / "crosstab_total_validation_report.xlsx"

# MASD combined sheet (required from 29-07-2026): carries the Block/Taluk of
# every learner keyed on 'User Account ID' and is used by the crosstab notebook
# to fill the blocks that case registration left blank. One file per district,
# same naming scheme everywhere: MASD_<District>_<DDMMYY>_combined.xlsx
MASD_DISTRICT_BY_CODE = {"UJ": "Ujjain", "JL": "Jalna", "ML": "Meghalaya"}


def find_masd_sheet(state_code):
    """Newest MASD_<District>_*_combined.xlsx in Inputs/ for this district code."""
    district = MASD_DISTRICT_BY_CODE.get(str(state_code).upper())
    if not district:
        return None, district
    hits = [p for p in INPUTS_DIR.glob(f"MASD_{district}_*_combined.xlsx")
            if p.is_file() and not p.name.startswith("~$")]
    if not hits:
        return None, district
    return max(hits, key=lambda p: p.stat().st_mtime), district
# MASTER_CSV_FILE (the merged CSV, e.g. UJ_110726_V(170726).csv) and
# ML_OUTPUT_FILE (the derived Excel, e.g. UJ_110726_Exc_V(170726)_2.xlsx)
# are determined dynamically after Stage 1 (see main()).

# Notebook Paths
SCRIPTS_DIR = WORKSPACE_DIR / "All scripts"
CLEANING_NOTEBOOK = SCRIPTS_DIR / "Cleaning, Combining and Merging.ipynb"
ML_NOTEBOOK = SCRIPTS_DIR / "ML_Pipeline(streamlined draft).ipynb"
CROSSTAB_NOTEBOOK = SCRIPTS_DIR / "CrossTab_streamlined pipeline.ipynb"

# Date Suffix (used in stage 1 cleaning file names)
# ADD-ON (NurtureHUB server): overridable per run so cleaned files carry the
# actual run date; default preserves the original hardcoded value.
RUN_DATE = os.environ.get("PIPELINE_RUN_DATE", "2026-06-18")

# ==============================================================================
# LOGGING SETUP
# ==============================================================================
log_file_path = WORKSPACE_DIR / "pipeline.log"

# Clear log file on startup
with open(log_file_path, "w", encoding="utf-8") as f:
    f.write(f"Pipeline started at {time.strftime('%Y-%m-%d %H:%M:%S')}\n\n")


class DualStream:
    """Redirects writes to both the original console stream and a log file."""
    def __init__(self, console_stream, log_fp):
        self.console = console_stream
        self.log_file = open(log_fp, "a", encoding="utf-8")

    def write(self, message):
        try:
            self.console.write(message)
        except UnicodeEncodeError:
            enc = getattr(self.console, 'encoding', None) or 'ascii'
            try:
                self.console.write(message.encode(enc, errors='replace').decode(enc))
            except Exception:
                self.console.write(message.encode('ascii', errors='replace').decode('ascii'))
        self.log_file.write(message)
        self.log_file.flush()

    def flush(self):
        self.console.flush()
        self.log_file.flush()

    def close(self):
        self.log_file.close()


def create_directory_structure():
    """Ensure all required directories in the pipeline are created."""
    print("Initializing directory structure...")
    dirs_to_create = [
        CLEANED_DIR, COMBINED_DIR, SUMMARIES_DIR,
        MASTER_DIR, DERIVED_DIR, OUTPUTS_DIR
    ]
    for d in dirs_to_create:
        if not d.exists():
            d.mkdir(parents=True, exist_ok=True)
            print(f"Created directory: {d}")
        else:
            print(f"Directory already exists: {d}")


def extract_nb_code(nb_path, line_replacements=None):
    """Reads a notebook file, extracts all code cell content, and optionally replaces specific lines."""
    if not nb_path.exists():
        raise FileNotFoundError(f"Notebook not found at: {nb_path}")

    with open(nb_path, "r", encoding="utf-8") as f:
        nb = json.load(f)

    code_cells = []
    for cell in nb["cells"]:
        if cell["cell_type"] == "code":
            source = "".join(cell["source"])
            if source.strip():
                code_cells.append(source)

    full_code = "\n\n# ==========================================\n\n".join(code_cells)

    # Apply line-level string replacements
    if line_replacements:
        for old_str, new_str in line_replacements.items():
            if old_str in full_code:
                full_code = full_code.replace(old_str, new_str)
                print(f"  Replaced: {old_str.strip()[:60]}...")
            else:
                print(f"  WARNING: Target string not found: {old_str.strip()[:60]}...")

    return full_code


def run_notebook_in_memory(stage_name, notebook_path, pre_code=None, cwd_override=None, line_replacements=None):
    """
    Executes notebook code cells in-memory.

    Args:
        stage_name: Name of the pipeline stage for logging.
        notebook_path: Path to the .ipynb file.
        pre_code: Optional Python code string to execute BEFORE the notebook code.
                  Used to inject path overrides into the namespace.
        cwd_override: Optional path to change the working directory to before execution.
    """
    print(f"\n==================================================")
    print(f"STARTING STAGE: {stage_name}")
    print(f"Notebook: {notebook_path.name}")
    print(f"==================================================")

    start_time = time.time()

    # Extract notebook code (with optional line replacements)
    nb_code = extract_nb_code(notebook_path, line_replacements=line_replacements)

    # Redirect stdout/stderr to capture print statements
    original_stdout = sys.stdout
    original_stderr = sys.stderr
    dual_stdout = DualStream(original_stdout, log_file_path)
    dual_stderr = DualStream(original_stderr, log_file_path)
    sys.stdout = dual_stdout
    sys.stderr = dual_stderr

    # Save original working directory
    original_cwd = os.getcwd()

    try:
        # Change working directory if needed
        if cwd_override:
            os.chdir(str(cwd_override))
            print(f"Working directory set to: {os.getcwd()}")

        # Create a clean global namespace for execution
        globals_dict = {
            "__name__": "__main__",
            "__builtins__": __builtins__
        }

        # Execute pre-code (path overrides) first
        if pre_code:
            print(f"Injecting path overrides...")
            exec(pre_code, globals_dict)

        # Execute the notebook code
        exec(nb_code, globals_dict)

        elapsed_time = time.time() - start_time
        print(f"\n=== Completed Stage: {stage_name} in {elapsed_time:.2f} seconds ===\n")
        return elapsed_time

    except Exception as e:
        print(f"\n!!! Error executing stage [{stage_name}]: {str(e)} !!!", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        raise

    finally:
        # Restore working directory
        os.chdir(original_cwd)
        # Restore standard streams
        sys.stdout = original_stdout
        sys.stderr = original_stderr
        dual_stdout.close()
        dual_stderr.close()


def main():
    print("==================================================")
    print("          STARTING MASTER DATA PIPELINE")
    print("==================================================")

    # 1. Pre-flight checks & Folder Creation
    create_directory_structure()

    print(f"Raw input folder: {RAW_INPUT_DIR}")

    # Check that raw inputs directory exists and has files
    if not RAW_INPUT_DIR.exists() or not any(RAW_INPUT_DIR.iterdir()):
        print(f"ERROR: Raw inputs folder '{RAW_INPUT_DIR}' is missing or empty!", file=sys.stderr)
        sys.exit(1)

    # Check that role sheet exists
    if not ROLE_SHEET_FILE.exists():
        print(f"ERROR: Role mapping sheet is missing at '{ROLE_SHEET_FILE}'!", file=sys.stderr)
        sys.exit(1)

    # Check that notebook scripts exist
    for nb_path in [CLEANING_NOTEBOOK, ML_NOTEBOOK, CROSSTAB_NOTEBOOK]:
        if not nb_path.exists():
            print(f"ERROR: Required notebook '{nb_path}' is missing!", file=sys.stderr)
            sys.exit(1)

    # Timing records
    times = {"cleaning": None, "ml": None, "crosstab": None, "validation": None}
    validation = None
    pipeline_start_time = time.time()
    pipeline_status = "FAILED"
    failed_stage = None
    error_message = None

    try:
        # ==================================================================
        # STAGE 1: Cleaning, Combining, and Merging
        # ==================================================================
        # The cleaning notebook uses relative paths like 'input_folder',
        # 'cleaned_files/', 'summaries/', 'combined_files/', 'merged_files/'.
        # We create symlinks/junctions or override the functions to use
        # our custom directory structure.
        #
        # Strategy: Change cwd to INPUTS_DIR, then create the relative
        # directories the notebook expects, pointing to our structure.
        # The notebook code uses:
        #   - run_all_cleaning(input_folder, output_folder, summary_folder, run_date)
        #     called as: run_all_cleaning('input_folder', 'cleaned_files', 'summaries', run_date)
        #   - run_all_step2() which hardcodes 'cleaned_files/{form}/' and 'combined_files/{form}_combined.csv'
        #   - run_clubbing_master(combined_folder="combined_files/", output_file="merged_files/...")
        #
        # By setting cwd=INPUTS_DIR, the relative paths 'input_folder',
        # 'cleaned_files', 'summaries', etc. resolve to INPUTS_DIR/input_folder, etc.
        # We need to ensure these directories exist there.

        # Note: The required folders (cleaned_files, combined_files, merged_files, summaries)
        # have already been initialized and verified at startup by create_directory_structure().

        # Pre-code to override the entry-point function calls.
        # The notebook defines functions, then calls them at the bottom.
        # We override the __main__ guard calls by injecting variables
        # that the notebook uses when calling those functions.
        cleaning_pre_code = f"""
import os
import sys
# Ensure notebook can find its imports
sys.path.insert(0, r'{INPUTS_DIR}')
# Point the cleaning notebook at the dated raw-input folder; the notebook
# derives the merged output name (e.g. UJ_110726_V(170726).csv) from it.
PIPELINE_RAW_INPUT_DIR = r'{RAW_INPUT_DIR}'
"""

        # Define replacements for Cleaning notebook to map folder names from *_files to clean names
        cleaning_replacements = {
            'output_folder="cleaned_files",': 'output_folder="cleaned",',
            'cleaned_dir = f"cleaned_files/{form_name}/"': 'cleaned_dir = f"cleaned/{form_name}/"',
            'output_file = f"combined_files/{form_name}_combined.csv"': 'output_file = f"combined/{form_name}_combined.csv"',
            'combined_folder="combined_files/"': 'combined_folder="combined/"',
            'output_file="merged_files/': 'output_file="merged/',
            'run_date="2026-04-05"': f'run_date="{RUN_DATE}"',
        }

        times["cleaning"] = run_notebook_in_memory(
            stage_name="Cleaning & Combining",
            notebook_path=CLEANING_NOTEBOOK,
            pre_code=cleaning_pre_code,
            cwd_override=INPUTS_DIR,
            line_replacements=cleaning_replacements
        )

        # After the cleaning notebook runs, dynamically find the merged CSV
        # in MASTER_DIR matching the pattern {XX}_{DDMMYY}_V({DDMMYY}).csv
        # (XX = state/district code: ML, JL, UJ, ...)
        merged_csvs = list(MASTER_DIR.glob("*_V(*).csv"))
        if not merged_csvs:
            raise FileNotFoundError(
                f"No merged CSV matching '*_V(*).csv' was found in: {MASTER_DIR}"
            )
        # Take the most recently modified if multiple exist
        cleaning_output = max(merged_csvs, key=lambda p: p.stat().st_mtime)
        print(f"Detected cleaning output: {cleaning_output.name}")

        # Extract the base name: e.g. UJ_110726_V(170726) from UJ_110726_V(170726).csv
        cleaning_base = cleaning_output.stem  # e.g. "UJ_110726_V(170726)"

        # Parse components:  State code _ CUD date  _V(  download date  )
        # Pattern: {XX}_{DDMMYY}_V({DDMMYY})
        base_match = re.match(r'^([A-Za-z]+_\d+)_V\((\d+)\)$', cleaning_base)
        if not base_match:
            raise ValueError(
                f"Cleaning output '{cleaning_base}' does not match expected "
                f"format '{{XX}}_{{DDMMYY}}_V({{DDMMYY}})'"
            )
        state_date_part = base_match.group(1)   # e.g. "UJ_110726"
        download_date = base_match.group(2)     # e.g. "170726"

        # The MASD combined sheet is a REQUIRED input (29-07-2026): stage 3 uses
        # it to fill the blocks missing from case registration. It is district
        # specific, so it can only be resolved once stage 1 has told us the code.
        state_code = state_date_part.split("_")[0]
        MASD_SHEET_FILE, masd_district = find_masd_sheet(state_code)
        if MASD_SHEET_FILE is None:
            available = sorted(p.name for p in INPUTS_DIR.glob("MASD_*"))
            raise FileNotFoundError(
                f"Required MASD combined sheet not found for district "
                f"'{masd_district or state_code}'. Expected "
                f"'{INPUTS_DIR}\\MASD_{masd_district or '<District>'}_<DDMMYY>_combined.xlsx'. "
                f"Found in Inputs: {available or 'none'}"
            )
        print(f"MASD block sheet: {MASD_SHEET_FILE.name} (district: {masd_district})")

        # Derive the derived-columns output file name:
        # UJ_110726_V(170726).csv  ->  UJ_110726_Exc_V(170726)_2.xlsx
        derived_name = f"{state_date_part}_Exc_V({download_date})_2.xlsx"
        ML_OUTPUT_FILE = DERIVED_DIR / derived_name
        print(f"Derived column output will be: {ML_OUTPUT_FILE.name}")

        # Stage 2 consumes the correctly named merged CSV directly
        MASTER_CSV_FILE = cleaning_output
        print(f"Validation success: Combined master CSV generated at {MASTER_CSV_FILE} ({MASTER_CSV_FILE.stat().st_size:,} bytes)")

        # ==================================================================
        # STAGE 2: ML Pipeline (Derived Columns)
        # ==================================================================
        # The ML notebook assigns constants like:
        #   INPUT_CSV          = '{XX}_DDMMYY_V(DDMMYY).csv'
        #   ROLE_SHEET         = 'Role and department sheet.xlsx'
        # and derives OUTPUT_FILE dynamically from INPUT_CSV
        # ({XX}_DDMMYY_V(DDMMYY).csv -> {XX}_DDMMYY_Exc_V(DDMMYY)_2.xlsx),
        # honouring an injected DERIVED_OUTPUT_DIR for the output location.

        master_csv_fwd = str(MASTER_CSV_FILE).replace("\\", "/")
        role_sheet_fwd = str(ROLE_SHEET_FILE).replace("\\", "/")
        ml_output_fwd = str(ML_OUTPUT_FILE).replace("\\", "/")

        # Extract notebook code, then do regex-based replacements
        ml_nb_code = extract_nb_code(ML_NOTEBOOK)

        # Replace INPUT_CSV = '...' with our path (any {XX}_*_V(*).csv pattern)
        ml_nb_code = re.sub(
            r"INPUT_CSV\s+=\s+'[A-Za-z]+_\d+_V\(\d+\)\.csv'",
            f"INPUT_CSV          = '{master_csv_fwd}'",
            ml_nb_code
        )
        # Replace ROLE_SHEET = '...' with our path
        ml_nb_code = re.sub(
            r"ROLE_SHEET\s+=\s+'Role and department sheet\.xlsx'",
            f"ROLE_SHEET         = '{role_sheet_fwd}'",
            ml_nb_code
        )

        print(f"ML Pipeline: INPUT_CSV  -> {master_csv_fwd}")
        print(f"ML Pipeline: OUTPUT_FILE -> {ml_output_fwd} (derived by the notebook)")

        # Execute the modified code directly (bypass line_replacements)
        # DERIVED_OUTPUT_DIR steers the notebook's dynamically named output
        # into Inputs/derived.
        ml_pre_code = f"""
import os, sys
sys.path.insert(0, r'{WORKSPACE_DIR}')
DERIVED_OUTPUT_DIR = r'{DERIVED_DIR}'
"""

        # Run the ML notebook with the pre-modified code
        print(f"\n==================================================")
        print(f"STARTING STAGE: ML Pipeline")
        print(f"Notebook: {ML_NOTEBOOK.name}")
        print(f"==================================================")

        start_time = time.time()
        original_stdout = sys.stdout
        original_stderr = sys.stderr
        dual_stdout = DualStream(original_stdout, log_file_path)
        dual_stderr = DualStream(original_stderr, log_file_path)
        sys.stdout = dual_stdout
        sys.stderr = dual_stderr
        original_cwd = os.getcwd()

        try:
            os.chdir(str(WORKSPACE_DIR))
            print(f"Working directory set to: {os.getcwd()}")

            globals_dict = {
                "__name__": "__main__",
                "__builtins__": __builtins__
            }

            if ml_pre_code:
                print(f"Injecting path overrides...")
                exec(ml_pre_code, globals_dict)

            exec(ml_nb_code, globals_dict)

            elapsed_time = time.time() - start_time
            print(f"\n=== Completed Stage: ML Pipeline in {elapsed_time:.2f} seconds ===\n")
            times["ml"] = elapsed_time

        except Exception as e:
            print(f"\n!!! Error executing stage [ML Pipeline]: {str(e)} !!!", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            raise

        finally:
            os.chdir(original_cwd)
            sys.stdout = original_stdout
            sys.stderr = original_stderr
            dual_stdout.close()
            dual_stderr.close()

        # Validate Stage 2 outputs
        if not ML_OUTPUT_FILE.exists():
            raise FileNotFoundError(f"ML derived column Excel output was not generated at: {ML_OUTPUT_FILE}")
        print(f"Validation success: Derived column Excel output generated at {ML_OUTPUT_FILE} ({ML_OUTPUT_FILE.stat().st_size:,} bytes)")

        # ==================================================================
        # STAGE 3: CrossTab Pipeline
        # ==================================================================
        # The CrossTab notebook assigns constants like:
        #   INPUT_FILE = "{XX}_DDMMYY_Exc_V(DDMMYY)_2.xlsx"
        #   OUTPUT_DIR = ".../outputs"          (column-wise %)
        #   OUTPUT_DIR_2 = ".../output_2"       (row-wise %)
        #   OUTPUT_DIR_JALNA(_2) = ...          (Jalna add-on, JL inputs only)
        # and re-stamps every output file name with the dataset code/version
        # carried by INPUT_FILE (dynamic naming).

        ml_output_fwd2 = str(ML_OUTPUT_FILE).replace("\\", "/")
        outputs_fwd = str(OUTPUTS_DIR).replace("\\", "/")

        # Extract CrossTab notebook code and do regex replacements
        crosstab_nb_code = extract_nb_code(CROSSTAB_NOTEBOOK)

        # Replace INPUT_FILE = "..." (config line) with our derived path
        crosstab_nb_code = re.sub(
            r'INPUT_FILE\s*=\s*["\'][A-Za-z]+_\d+_Exc_V\(\d+\)_2(?:\.xlsx)?["\']',
            f'INPUT_FILE = "{ml_output_fwd2}"',
            crosstab_nb_code
        )
        # Replace the four output directories with the pipeline's own
        crosstab_nb_code = re.sub(
            r'OUTPUT_DIR\s*=\s*(?:r)?["\'][^"\']*/outputs["\']',
            f'OUTPUT_DIR = "{outputs_fwd}"',
            crosstab_nb_code
        )
        crosstab_nb_code = re.sub(
            r'OUTPUT_DIR_2\s*=\s*(?:r)?["\'][^"\']*/output_2["\']',
            f'OUTPUT_DIR_2 = "{outputs_fwd}/output_2"',
            crosstab_nb_code
        )
        crosstab_nb_code = re.sub(
            r'OUTPUT_DIR_JALNA\s*=\s*(?:r)?["\'][^"\']*/output_jalna["\']',
            f'OUTPUT_DIR_JALNA = "{outputs_fwd}/output_jalna"',
            crosstab_nb_code
        )
        crosstab_nb_code = re.sub(
            r'OUTPUT_DIR_JALNA_2\s*=\s*(?:r)?["\'][^"\']*/output_jalna_2["\']',
            f'OUTPUT_DIR_JALNA_2 = "{outputs_fwd}/output_jalna_2"',
            crosstab_nb_code
        )
        # ADD-ON (NurtureHUB server): ANALYSIS_LEVEL must be "state" for a
        # Meghalaya run and "district" elsewhere. The notebook hardcodes
        # "district"; when PIPELINE_ANALYSIS_LEVEL is set we rewrite it, so the
        # caller never has to edit the notebook per district. Unset = untouched.
        _analysis_level = os.environ.get("PIPELINE_ANALYSIS_LEVEL", "").strip()
        if _analysis_level:
            crosstab_nb_code, _n_lvl = re.subn(
                r'ANALYSIS_LEVEL\s*=\s*["\'](?:district|state)["\']',
                f'ANALYSIS_LEVEL = "{_analysis_level}"',
                crosstab_nb_code
            )
            if _n_lvl:
                print(f"CrossTab Pipeline: ANALYSIS_LEVEL -> {_analysis_level}")
            else:
                print("WARNING: PIPELINE_ANALYSIS_LEVEL set but the ANALYSIS_LEVEL "
                      "assignment was not found in the notebook — left unchanged.")

        # Hand the crosstab notebook the district's MASD combined sheet; it fills
        # BLOCK_COL for the cases whose 'Phc Taluka_CR' is blank (ADD-ON STEP 2b).
        crosstab_pre_code = f"""
MASD_BLOCK_SHEET = r'{MASD_SHEET_FILE}'
"""

        print(f"CrossTab Pipeline: INPUT_FILE -> {ml_output_fwd2}")
        print(f"CrossTab Pipeline: OUTPUT_DIR -> {outputs_fwd}")
        print(f"CrossTab Pipeline: OUTPUT_DIR_2 -> {outputs_fwd}/output_2")
        print(f"CrossTab Pipeline: MASD_BLOCK_SHEET -> {MASD_SHEET_FILE}")

        # Run the CrossTab notebook with the pre-modified code
        print(f"\n==================================================")
        print(f"STARTING STAGE: CrossTab Pipeline")
        print(f"Notebook: {CROSSTAB_NOTEBOOK.name}")
        print(f"==================================================")

        start_time = time.time()
        original_stdout = sys.stdout
        original_stderr = sys.stderr
        dual_stdout = DualStream(original_stdout, log_file_path)
        dual_stderr = DualStream(original_stderr, log_file_path)
        sys.stdout = dual_stdout
        sys.stderr = dual_stderr
        original_cwd = os.getcwd()

        try:
            os.chdir(str(WORKSPACE_DIR))
            print(f"Working directory set to: {os.getcwd()}")

            globals_dict = {
                "__name__": "__main__",
                "__builtins__": __builtins__
            }

            print(f"Injecting path overrides...")
            exec(crosstab_pre_code, globals_dict)

            exec(crosstab_nb_code, globals_dict)

            elapsed_time = time.time() - start_time
            print(f"\n=== Completed Stage: CrossTab Pipeline in {elapsed_time:.2f} seconds ===\n")
            times["crosstab"] = elapsed_time

        except Exception as e:
            print(f"\n!!! Error executing stage [CrossTab Pipeline]: {str(e)} !!!", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            raise

        finally:
            os.chdir(original_cwd)
            sys.stdout = original_stdout
            sys.stderr = original_stderr
            dual_stdout.close()
            dual_stderr.close()

        # Validate Stage 3 outputs. A Jalna (JL) input writes ONLY to the
        # outputs/output_jalna(_2) subfolders (mutually-exclusive routing in the
        # crosstab notebook), so search subfolders too; '~$*' Excel lock files
        # (a workbook open in Excel) are not outputs.
        crosstab_files = [f for f in OUTPUTS_DIR.rglob("*.xlsx")
                          if not f.name.startswith("~$")]
        if not crosstab_files:
            raise FileNotFoundError(f"No Crosstab Excel files were generated in: {OUTPUTS_DIR}")
        print(f"Validation success: {len(crosstab_files)} Crosstab Excel files generated in {OUTPUTS_DIR}")

        # ==================================================================
        # STAGE 4: CrossTab total validation
        # ==================================================================
        # Re-open every exported workbook and check that the printed counts
        # actually add up to the printed Total, column-wise AND row-wise, for
        # every table. Writes a report workbook next to pipeline_report.txt.
        # Read-only: it can never change a crosstab result.
        print(f"\n==================================================")
        print(f"STARTING STAGE: CrossTab Total Validation")
        print(f"==================================================")
        start_time = time.time()
        original_stdout = sys.stdout
        original_stderr = sys.stderr
        dual_stdout = DualStream(original_stdout, log_file_path)
        dual_stderr = DualStream(original_stderr, log_file_path)
        sys.stdout = dual_stdout
        sys.stderr = dual_stderr
        try:
            import validate_crosstab_totals
            validation = validate_crosstab_totals.validate(OUTPUTS_DIR, VALIDATION_REPORT_FILE)
            times["validation"] = time.time() - start_time
            print(f"  Workbooks scanned        : {validation['files']}")
            print(f"  Crosstab tables checked  : {validation['tables']}")
            print(f"  Column-wise mismatches   : {validation['col_mismatch']}")
            print(f"  Row-wise mismatches      : {validation['row_mismatch']}")
            for cat, n in validation['categories'].items():
                print(f"    - {cat}: {n}")
            print(f"  UNEXPLAINED mismatches   : {validation['unexplained']}")
            print(f"  Report                   : {validation['report']}")
            if validation['unexplained']:
                print(f"  !!! {validation['unexplained']} UNEXPLAINED mismatch(es) -"
                      f" see the 'Mismatches' sheet of the report !!!", file=sys.stderr)
            print(f"\n=== Completed Stage: CrossTab Total Validation in "
                  f"{times['validation']:.2f} seconds ===\n")
        except Exception as e:
            # Validation must never take the pipeline down - the crosstabs are
            # already written and correct at this point.
            validation = {"error": str(e)}
            print(f"  !!! Validation stage failed: {e} !!!", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
        finally:
            sys.stdout = original_stdout
            sys.stderr = original_stderr
            dual_stdout.close()
            dual_stderr.close()

        pipeline_status = "SUCCESS"

    except Exception as e:
        pipeline_status = "FAILED"
        error_message = str(e)
        if times["cleaning"] is None:
            failed_stage = "Cleaning & Combining"
        elif times["ml"] is None:
            failed_stage = "ML Pipeline"
        else:
            failed_stage = "CrossTab Pipeline"

    total_runtime = time.time() - pipeline_start_time

    # Format stage run times
    cleaning_time_str = f"{times['cleaning']:.2f} sec" if times["cleaning"] is not None else "FAILED"
    ml_time_str = f"{times['ml']:.2f} sec" if times["ml"] is not None else "FAILED"
    crosstab_time_str = f"{times['crosstab']:.2f} sec" if times["crosstab"] is not None else "FAILED"
    validation_time_str = f"{times['validation']:.2f} sec" if times["validation"] is not None else "NOT RUN"

    # ==============================================================================
    # PRINT PIPELINE EXECUTION REPORT
    # ==============================================================================
    print("\n" + "="*50)
    print("PIPELINE EXECUTION REPORT")
    print("="*50)
    print(f"Cleaning & Combining     : {cleaning_time_str}")
    print(f"ML Pipeline              : {ml_time_str}")
    print(f"CrossTab Pipeline        : {crosstab_time_str}")
    print(f"Total Validation         : {validation_time_str}")
    print()
    print(f"Total Runtime            : {total_runtime:.2f} sec")
    print()
    print(f"Status                   : {pipeline_status}")
    if pipeline_status == "FAILED":
        print(f"Failed Stage             : {failed_stage}")
        print(f"Error                    : {error_message}")
    print("="*50 + "\n")

    # Save a report file summary next to logs
    with open(WORKSPACE_DIR / "pipeline_report.txt", "w", encoding="utf-8") as f:
        f.write("==================================================\n")
        f.write("PIPELINE EXECUTION REPORT\n")
        f.write("==================================================\n")
        f.write(f"Cleaning & Combining     : {cleaning_time_str}\n")
        f.write(f"ML Pipeline              : {ml_time_str}\n")
        f.write(f"CrossTab Pipeline        : {crosstab_time_str}\n")
        f.write(f"Total Validation         : {validation_time_str}\n\n")
        f.write(f"Total Runtime            : {total_runtime:.2f} sec\n\n")
        f.write(f"Status                   : {pipeline_status}\n")
        if isinstance(validation, dict) and "error" not in validation:
            f.write("\nCROSSTAB TOTAL VALIDATION\n")
            f.write(f"  Workbooks scanned      : {validation['files']}\n")
            f.write(f"  Tables checked         : {validation['tables']}\n")
            f.write(f"  Column-wise mismatches : {validation['col_mismatch']}\n")
            f.write(f"  Row-wise mismatches    : {validation['row_mismatch']}\n")
            for _c, _n in validation["categories"].items():
                f.write(f"    - {_c}: {_n}\n")
            f.write(f"  UNEXPLAINED            : {validation['unexplained']}\n")
            f.write(f"  Verdict                : "
                    f"{'PASS' if validation['unexplained'] == 0 else 'FAIL'}\n")
            f.write(f"  Report                 : {VALIDATION_REPORT_FILE.name}\n")
        elif isinstance(validation, dict):
            f.write(f"\nCROSSTAB TOTAL VALIDATION : FAILED -> {validation['error']}\n")
        if pipeline_status == "FAILED":
            f.write(f"Failed Stage             : {failed_stage}\n")
            f.write(f"Error                    : {error_message}\n")
        f.write("==================================================\n")


if __name__ == "__main__":
    main()
