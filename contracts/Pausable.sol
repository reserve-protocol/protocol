// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";

import "contracts/p0/interfaces/IMain.sol";

/** Contract mixin providing:
 * - The paused flag
 * - A pauser role, modifiable by pauser or owner
 * - Pause and unpause commands, to allow either pauser or owner to set the paused flag.
 * - The `notPaused` modifier.
 */
contract Pausable is Ownable, IPausable {
    address private _pauser;
    bool public override paused;

    constructor() {
        _pauser = _msgSender();
    }

    modifier notPaused() {
        require(!paused, "paused");
        _;
    }

    function pause() external override {
        require(_msgSender() == _pauser || _msgSender() == owner(), "only pauser or owner");
        paused = true;
    }

    function unpause() external override {
        require(_msgSender() == _pauser || _msgSender() == owner(), "only pauser or owner");
        paused = false;
    }

    function pauser() external view override returns (address) {
        return _pauser;
    }

    function setPauser(address pauser_) external override {
        require(_msgSender() == _pauser || _msgSender() == owner(), "only pauser or owner");
        _pauser = pauser_;
    }
}
