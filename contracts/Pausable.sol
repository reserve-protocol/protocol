// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "contracts/interfaces/IMain.sol";

/// Only Main is Pausable
abstract contract Pausable is OwnableUpgradeable, IPausable {
    address private _pauser;
    bool public paused;

    // solhint-disable-next-line func-name-mixedcase
    function __Pausable_init() internal onlyInitializing {
        __Ownable_init();
        _pauser = _msgSender();
        paused = true;
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
        require(pauser_ != address(0), "use renouncePauser");
        emit PauserSet(_pauser, pauser_);
        _pauser = pauser_;
    }

    function renouncePausership() external {
        require(_msgSender() == _pauser || _msgSender() == owner(), "only pauser or owner");
        emit PauserSet(_pauser, address(0));
        _pauser = address(0);
    }
}
