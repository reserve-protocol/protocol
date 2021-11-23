// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "./Ownable.sol";

/** Contract mixin providing:
 * - The paused flag
 * - A pauser role, modifiable by pauser or owner
 * - Pause and unpause commands, to allow either pauser or owner to set the paused flag.
 * - The `notPaused` modifier.
 */
contract Pausable is Ownable {
    address private _pauser;
    bool public override paused;

    constructor() {
        _pauser = _msgSender();
    }

    modifier notPaused() {
        require(!paused, "paused");
        _;
    }

    function pause() external {
        require(_msgSender() == _pauser || _msgSender() == owner(), "only pauser or owner");
        paused = true;
    }

    function unpause() external {
        require(_msgSender() == _pauser || _msgSender() == owner(), "only pauser or owner");
        paused = false;
    }

    function pauser() public returns (address) {
        return pauser;
    }

    function setPauser(address pauser_) external {
        require(_msgSender() == pauser || _msgSender() == owner(), "only pauser or owner");
        _pauser = pauser_;
    }
}
