#!/usr/bin/env python3
from os import rename
from sys import argv
from pathlib import Path
from subprocess import run

# Returns the project root above the current working directory, as a pathlib.Path
def proj_root():
    curr = Path.cwd()
    for d in [curr, *curr.parents]:
        if (d / ".git").exists():
            return d
    raise Exception("Could not find a project root")


project: Path
project = proj_root()
file_orig = project / "contracts/facade/FacadeAct.sol"
file_temp = file_orig.with_suffix(".sol.ignored")

try:
    # Move away FacadeAct so that Slither doesn't choke on it
    if file_orig.exists():
        rename(file_orig, file_temp)

    # run slither from inside the tools directory
    args = argv[1:]
    run(["slither", "../", *args], cwd=project / "tools")

finally:
    # Move back FacadeAct, even if the process was ended by ctrl-C or something
    if file_temp.exists():
        rename(file_temp, file_orig)
