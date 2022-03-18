#!/bin/bash -euxo pipefail
# Make known dynamic libraries static, by processing them with make-static-lib.py

# There's just one right now. Separate further entries with spaces.
DYNLIBS='contracts/p0/mixins/TradingLib.sol'

# cd to root
while [ ! -d .git -a `pwd` != "/" ]; do cd ..; done

for lib in ${DYNLIBS}; do
  # Copy over lib
  cp ${lib} ${lib}.original
  rm ${lib}
  # Process with little stream processor
  python3 tools/make-static-lib.py < ${lib}.original > ${lib}
done
