// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import "../vendor/IMToken.sol";
import { MockMidasAccessControl } from "./MockMidasAccessControl.sol";
import "@openzeppelin/contracts-upgradeable/access/IAccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";

contract MockMToken is ERC20PausableUpgradeable, IMToken {
    bytes32 public constant M_TBILL_PAUSE_OPERATOR_ROLE = keccak256("M_TBILL_PAUSE_OPERATOR_ROLE");
    bytes32 public constant M_BTC_PAUSE_OPERATOR_ROLE = keccak256("M_BTC_PAUSE_OPERATOR_ROLE");

    MockMidasAccessControl private _mockMidasAccessControl;

    function initialize(string memory name_, string memory symbol_) external initializer {
        __ERC20_init(name_, symbol_);
        __ERC20Pausable_init();
        _mockMidasAccessControl = new MockMidasAccessControl();
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function pause() external {
        _pause();
    }

    function unpause() external {
        _unpause();
    }

    function accessControl() external view override returns (IAccessControlUpgradeable) {
        return IAccessControlUpgradeable(address(_mockMidasAccessControl));
    }

    function paused() public view override(PausableUpgradeable, IMToken) returns (bool) {
        return PausableUpgradeable.paused();
    }
}
