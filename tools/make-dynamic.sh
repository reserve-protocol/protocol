#!/bin/bash
# Overcopy any ".original" files, back to where they came from
# This will recover state from make-static.sh

# cd to root
while [ ! -d .git -a `pwd` != "/" ]; do cd ..; done

for
