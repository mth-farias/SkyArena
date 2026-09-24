"""Generate closed zebrafish fictive tracks from a locomotion HMM.

Uses the same (v||, v⊥) first-order sampler as the fly tracks
(Tao et al. 2019 eLife 8:e41235). Fish motion science:
Dommanget-Kott et al. 2024 (doi:10.1101/2024.11.22.624881).

This module does **not** fit the Dommanget-Kott hierarchical model.
It keeps the real 10 Hz track and uses a short HMM walk to close
the loop back to the first sample.

Sources: NOTICE (Dommanget-Kott 2024; Tao 2019; idtracker.ai).
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
