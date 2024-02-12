# Echidna

> Echidna is a Haskell program designed for fuzzing/property-based testing of Ethereum smart contracts. It uses sophisticated grammar-based fuzzing campaigns based on a contract ABI to falsify user-defined predicates or Solidity assertions.

Our usage of Echidna is immature; we've used it only just enough to get a handful of proof-of-concept results, not as a day-to-day part of our toolchain. These notes are useful but preliminary!

## Installation

First, you need solc-select and slither, Echidna requires both. These are part of our [core tools setup](dev-env.md). To handle recent Solidity language changes, you'll need to use Echidna 2.0. Setup following [their instructions](https://github.com/crytic/echidna/#installation).

If you're using the "mostly-static" precompiled binaries for MacOS, putting the contents of that build somewhere in your `PATH` will install it. However, that build is a binary plus a handful of dynamic libs that it's expecting to find as siblings in its directory. To keep things clean, I recommend installing the binary to its own directory somewhere, and then putting an executable symlink in your PATH.

## Avoiding Dynamic Libraries

For Echidna to run, our Solidity code [cannot contain dynamic libraries](https://github.com/crytic/echidna/#limitations-and-known-issues). Our deployment code contains dynamic libraries, so something must be done.

In order to support this:

- All of our fuzzing work happens in the `fuzz` branch, which is a long-lived branch downstream of `master`.
- The contract code in `fuzz` is rearranged as needed to be static-libraries. This should be the only reason why target-system contract code is different between `fuzz` and `master`.

Given all that, **never merge `fuzz` into `master`**.

## Usage

Echidna runs are typically pretty slow. Frequently, your system has to generate _lots_ and _lots_ of iterations for any particular property under test, but it _can_ make surprising progress after a long runtime. This means that you'll probably either do things just a few tests at a time, reasoning interactively and getting things right, or you'll launch a long fuzzing campaign on a remote system, and then await the results.

Remote campaigns are _not_ set up yet, we're still in the local-system-fiddling stage.

In interactive testing, the command I've been using is:

    yarn compile && echidna-test . --contract {CONTRACT} --corpus-dir echidna-corpus

Some notes:

- It seems like echidna-test will _not_ reliably compile your changes for you. (Even though it's definitely doing _something_ like compilation... curious...) You've got to re-run `yarn compile` anytime you've changed any solidity contracts, either the test driver or your target contracts.
- echidna-test accepts a single test driver contract. You'll need to do a separate run to test separate test contracts.
- The contract name to specify after `--contract` is just the base contract name. It's not qualified by its import path.
- If you're using a corpus-dir -- and you probably should, so that you get visibility into fuzzing coverage -- then any time you've changed a contract ABI in any important way, make sure you delete it before you continue!

The [Echidna tutorial](https://github.com/crytic/building-secure-contracts/tree/master/program-analysis/echidna#echidna-tutorial) is a little out-of-date, but excellent background material, and well worth reading. When I last looked, it hadn't been updated with new features and interface descriptions, so you should also check out a >=2.0 [release notes](https://github.com/crytic/echidna/releases/tag/v2.0.0).

Among the release notes, especially note the use of `--testMode`! Very important!
