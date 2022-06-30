// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/mixins/ComponentRegistry.sol";
import "contracts/mixins/Auth.sol";

/**
 * @title Main
 * @notice Collects all mixins.
 */
// solhint-disable max-states-count
contract MainP0 is Initializable, Auth, ComponentRegistry, IMain {
    using FixLib for uint192;

    IERC20 public rsr;

    /// Initializer
    function init(
        Components memory components,
        IERC20 rsr_,
        uint32 oneshotPauseDuration_
    ) public virtual initializer {
        __Auth_init(oneshotPauseDuration_);
        __ComponentRegistry_init(components);

        rsr = rsr_;
        emit MainInitialized();
    }

    /// @custom:refresher
    function poke() external {
        require(!paused, "paused");
        assetRegistry.refresh();
        furnace.melt();
        stRSR.payoutRewards();
        // NOT basketHandler.refreshBasket
    }

    function hasRole(bytes32 role, address account)
        public
        view
        override(AccessControlUpgradeable, IMain)
        returns (bool)
    {
        return super.hasRole(role, account);
    }
}
