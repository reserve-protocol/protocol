// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "contracts/interfaces/IMain.sol";

/// Only Main is Pausable
abstract contract Pausable is OwnableUpgradeable, IPausable {
    address public oneshotPauser;

    uint32 public unpauseAt; // {s} 0 when not paused, uint32.max to pause indefinitely

    uint32 public oneshotPauseDuration; // {s} gov param that controls length of a oneshotPauser-based pause

    // solhint-disable-next-line func-name-mixedcase
    function __Pausable_init(uint32 oneshotPauseDuration_) internal onlyInitializing {
        __Ownable_init();
        oneshotPauser = _msgSender();
        oneshotPauseDuration = oneshotPauseDuration_;

        // begin paused
        unpauseAt = type(uint32).max;
    }

    function paused() public view returns (bool) {
        return (block.timestamp < unpauseAt);
    }

    // === By owner or pauser ===

    function pause() external {
        require(_msgSender() == oneshotPauser || _msgSender() == owner(), "only pauser or owner");

        uint32 newUnpauseAt;
        if (_msgSender() == owner()) {
            // Pause indefinitely
            // Justification: governance can `setOneshotPauser` at same time
            newUnpauseAt = type(uint32).max;
        } else {
            // Renounce pausership
            oneshotPauser = address(0);
            emit OneshotPauserSet(oneshotPauser, address(0));

            // Unpause in `oneshotPauseDuration` seconds
            newUnpauseAt = uint32(block.timestamp) + oneshotPauseDuration;
        }
        emit UnpauseAtSet(unpauseAt, newUnpauseAt);
        unpauseAt = newUnpauseAt;
    }

    function unpause() external {
        require(_msgSender() == oneshotPauser || _msgSender() == owner(), "only pauser or owner");
        emit UnpauseAtSet(unpauseAt, uint32(block.timestamp));
        unpauseAt = uint32(block.timestamp);
    }

    function renouncePausership() external {
        require(_msgSender() == oneshotPauser || _msgSender() == owner(), "only pauser or owner");
        emit OneshotPauserSet(oneshotPauser, address(0));
        oneshotPauser = address(0);
    }

    function setOneshotPauser(address oneshotPauser_) external {
        require(_msgSender() == oneshotPauser || _msgSender() == owner(), "only pauser or owner");
        require(oneshotPauser_ != address(0), "use renouncePauser");
        emit OneshotPauserSet(oneshotPauser, oneshotPauser_);
        oneshotPauser = oneshotPauser_;
    }

    // === By owner only ===

    function setOneshotPauseDuration(uint32 oneshotPauseDuration_) external {
        require(_msgSender() == owner(), "only owner");
        emit OneshotPauseDurationSet(oneshotPauseDuration, oneshotPauseDuration_);
        oneshotPauseDuration = oneshotPauseDuration_;
    }
}
