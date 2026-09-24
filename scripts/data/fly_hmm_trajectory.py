"""Generate closed Drosophila fictive tracks from a locomotion HMM.

Tao, L., Ozarkar, S., Beck, J. & Bhandawat, V. (2019). Statistical
structure of locomotion and its modulation by odors. eLife 8:e41235
(doi:10.7554/eLife.41235). Official MATLAB:
https://github.com/bhandawat/HHMM (GPL-3.0).

This module does **not** port their hierarchical variational HMM. It
fits the workshop first-order sampler on (v||, v⊥) from each
idtracker.ai identity and uses it only to close the real 10 Hz
track back to the first sample.

Sources: NOTICE (Tao 2019; idtracker.ai).
"""

from __future__ import annotations

from locomotion_hmm import (
    close_wide_table,
    generate_fictive_trajectory,
    loop_identities,
    loop_wide_table,
    parse_idtracker_csv,
)

__all__ = [
    "close_wide_table",
    "generate_fictive_trajectory",
    "loop_identities",
    "loop_wide_table",
    "parse_idtracker_csv",
]
