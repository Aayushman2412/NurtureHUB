"""Raw-data export: generate the analytics pipelines' raw input files from
NurtureHUB's own collected data (admin Database → Raw Data section).

One module per output file (gen_*.py), a shared Dataset/helpers layer
(common.py), a mock-data factory for localhost testing (mock.py, gated by
RAW_EXPORT_MOCK) and the storage/ingest orchestration (service.py).
"""
