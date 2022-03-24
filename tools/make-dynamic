#!/bin/bash -euo pipefail
# Overcopy any ".original" files, back to where they came from
# This will recover state from make-static.sh

# cd to project root
while [ ! -d .git -a `pwd` != "/" ]; do cd ..; done

for fname in $(find contracts -name '*.sol.original'); do
  mv -f ${fname} ${fname%.original}
done
