// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "../../interfaces/IComponent.sol";
import "../../interfaces/IMain.sol";
import "../../mixins/Versioned.sol";

/**
 * Abstract superclass for system contracts registered in Main
 */
abstract contract ComponentP1 is
    Versioned,
    Initializable,
    ContextUpgradeable,
    UUPSUpgradeable,
    IComponent
{
    IMain public main;

    /// @custom:oz-upgrades-unsafe-allow constructor
    // solhint-disable-next-line no-empty-blocks
    constructor() initializer {}

    // Sets main for the component - Can only be called during initialization
    // untestable:
    //      `else` branch of `onlyInitializing` (ie. revert) is currently untestable.
    //      This function is only called inside other `init` functions, each of which is wrapped
    //      in an `initializer` modifier, which would fail first.
    // solhint-disable-next-line func-name-mixedcase
    function __Component_init(IMain main_) internal onlyInitializing {
        require(address(main_) != address(0), "main is zero address");
        __UUPSUpgradeable_init();
        main = main_;
    }

    // === See docs/pause-freeze-states.md ===

    modifier notTradingPausedOrFrozen() {
        require(!main.tradingPausedOrFrozen(), "frozen or trading paused");
        _;
    }

    modifier notIssuancePausedOrFrozen() {
        require(!main.issuancePausedOrFrozen(), "frozen or issuance paused");
        _;
    }

    modifier notFrozen() {
        require(!main.frozen(), "frozen");
        _;
    }

    modifier governance() {
        require(main.hasRole(OWNER, _msgSender()), "governance only");
        _;
    }

    modifier onlyMain() {
        require(_msgSender() == address(main), "main only");
        _;
    }

    // solhint-disable-next-line no-empty-blocks
    function _authorizeUpgrade(address newImplementation) internal view override onlyMain {}

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[49] private __gap;
}
