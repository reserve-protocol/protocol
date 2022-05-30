# Echidna

> Echidna is a Haskell program designed for fuzzing/property-based testing of Ethereum smarts contracts. It uses sophisticated grammar-based fuzzing campaigns based on a contract ABI to falsify user-defined predicates or Solidity assertions.

Our usage of Echidna is immature; we've used it only just enough to get a handful of proof-of-concept results, not as a day-to-day part of our toolchain. These notes are useful but preliminary!

## Installation

First, you need solc-select and slither, Echidna requires both. These are part of our [core tools setup](dev-env.md). To handle recent Solidity language changes, you'll need to use Echidna 2.0. Setup following [their instructions](https://github.com/crytic/echidna/#installation). 

If you're using the "mostly-static" precompiled binaries for MacOS, putting the contents of that build somewhere in your `PATH` will install it. However, that build is a binary plus a handful of dynamic libs that it's expecting to find as siblings in its directory. To keep things clean, I recommend installing the binary to its own directory somewhere, and then putting an executable symlink in your PATH.

## Usage

Echidna runs are typically pretty slow. Frequently, your system has to generate _lots_ and _lots_ of iterations for any particular property under test, but it _can_ make surprising progress after a long runtime. This means that you'll probably either do things just a few tests at a time, reasoning interactively and getting things right, or you'll launch a long fuzzing campaign on a remote system, and then await the results.

Remote campaigns are _not_ set up yet, we're still in the local-system-fiddling stage.

In interactive testing, the command I've been using is:

    yarn compile && echidna-test . --contract {CONTRACT} --corpus-dir echidna-corpus

Some notes:

- echidna-test will _not_ compile your changes for you. You've got to re-run `yarn compile` anytime you've changed any solidity contracts, either the test driver or your target contracts.
- echidna-test accepts a single test driver contract. You'll need to do a separate run to test separate test contracts.
- the contract name to specify after `--contract` is just the base contract name; it's not qualified by, say, its import path.
- If you're using a corpus-dir -- and you probably should -- then any time you've changed a contract ABI in any important way, make sure you delete it before you continue!

The [Echidna tutorial](https://github.com/crytic/building-secure-contracts/tree/master/program-analysis/echidna#echidna-tutorial) is a little out-of-date, but excellent background material, and well worth reading. When I last looked, it hadn't been updated with new features and interface descriptions, so you should also check out the 2.0 [release notes](https://github.com/crytic/echidna/releases/tag/v2.0.0).

Among the release notes, especially note the use of `--testMode`! Very important!

## Avoiding Dynamic Libraries

For Echidna to run, our Solidity code [cannot contain dynamic libraries](https://github.com/crytic/echidna/#limitations-and-known-issues). Our deployment code absolutely does contain dynamic libraries, so something must be done.

The simplest thing is to run through all of our library contracts, and redeclare all of their `public` and `external` functions instead to be `internal`. This causes Solidity to instead link those libraries statically -- that is, at compile time, solc just copies that function bytecode into any contract that calls them.

This would obviously be a pain to do by hand, so I've set up a little automation in `tools` to help do this. From your shell, `cd` anywhere into the project and execute `tools/make-static.sh`. For each dynamic library contract `path/foo.sol` in our codebase, 1t will:

- copy the original library to a backup file `path/foo.sol.original`
- replace all instances of tokens `public` and `external` with `internal` inside `path/foo.sol`
- stick a warning comment at the top of `path/foo.sol` that says not to change or commit that file.

I've also added a pre-commit hook to help keep you from committing these files; whenever you do `git commit`, it'll abort if any file in your live directory has the `DO_NOT_COMMIT` keyword somewhere in its first 10 lines. (`*.sol.original` files should also be in `.gitignore`, so you won't accidentally commit those.)

To undo the changes that `tools/make-static.sh` causes, just run `tools/make-dynamic.sh`. In particular, this should enable you to commit changes again!
