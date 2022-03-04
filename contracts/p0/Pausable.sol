// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "contracts/interfaces/IPausable.sol";

/** Contract mixin providing:
 * - The paused flag
 * - A pauser role, modifiable by pauser or owner
 * - Pause and unpause commands, to allow either pauser or owner to set the paused flag.
 * - The `notPaused` modifier.
 */
contract Pausable is Ownable, IPausable {
    address private _pauser;
    bool public paused;

    constructor() {
        _pauser = _msgSender();
        paused = true;
    }

    modifier notPaused() {
        require(!paused, "paused");
        _;
    }

    function pause() external {
        require(_msgSender() == _pauser || _msgSender() == owner(), "only pauser or owner");
        emit PausedSet(paused, true);
        paused = true;
    }

    function unpause() external {
        require(_msgSender() == _pauser || _msgSender() == owner(), "only pauser or owner");
        emit PausedSet(paused, false);
        paused = false;
    }

    function pauser() external view returns (address) {
        return _pauser;
    }

    function setPauser(address pauser_) external {
        require(_msgSender() == _pauser || _msgSender() == owner(), "only pauser or owner");
        emit PauserSet(_pauser, pauser_);
        _pauser = pauser_;
    }
}
