#!/bin/bash -euo pipefail
# Make known dynamic libraries static, by processing them with make-static-lib.py

# cd to project root
while [ ! -d .git -a `pwd` != "/" ]; do cd ..; done

# Add further dynamic libs here, separated by any amount of whitespace or newlines
DYNLIBS="contracts/p0/mixins/TradingLib.sol"

for lib in ${DYNLIBS}; do
  # Don't do anything if this lib has already been made static.
  if (head -n 10 ${lib} | grep -q DO_NOT_COMMIT) ; then continue; fi
  # Copy over lib
  cp ${lib} ${lib}.original
  rm ${lib}
  # Process with little stream processor
  python3 tools/make-static-lib.py < ${lib}.original > ${lib}
done
