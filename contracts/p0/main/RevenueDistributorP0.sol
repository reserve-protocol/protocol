// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/main/Mixin.sol";
import "contracts/p0/main/SettingsHandlerP0.sol";
import "contracts/libraries/Fixed.sol";

contract RevenueDistributorP0 is Ownable, Mixin, SettingsHandlerP0, IRevenueDistributor {
    using SafeERC20 for IERC20;
    using FixLib for Fix;
    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet internal _destinations;
    mapping(address => RevenueShare) internal _distribution;
    // Values: [RToken fraction, RSR fraction]
    // invariant: distribution values are all nonnegative, and at least one is nonzero.

    address constant FURNACE = address(1);
    address constant ST_RSR = address(2);

    function init(ConstructorArgs calldata args) public virtual override(Mixin, SettingsHandlerP0) {
        super.init(args);
        setDistribution(FURNACE, RevenueShare(args.dist.rTokenDist, FIX_ZERO));
        setDistribution(ST_RSR, RevenueShare(FIX_ZERO, args.dist.rsrDist));
    }

    function setDistribution(
        address dest,
        RevenueShare memory share
    ) public override onlyOwner {
        _destinations.add(dest);
        _distribution[dest] = share;
    }

    /// Requires an allowance
    function distribute(
        IERC20 erc20,
        address from,
        uint256 amount
    ) public override {
        require(erc20 == rsr() || erc20 == rToken(), "RSR or RToken");
        (Fix rTokenTotal, Fix rsrTotal) = _totals();
        Fix total = erc20 == rsr() ? rsrTotal : rTokenTotal;
        for (uint256 i = 0; i < _destinations.length(); i++) {
            Fix subshare = erc20 == rsr() ?
                _distribution[_destinations.at(i)].rsrDist :
                _distribution[_destinations.at(i)].rTokenDist;
            uint256 slice = subshare.mulu(amount).div(total).toUint();

            address addr_to = _destinations.at(i);
            if (addr_to == FURNACE) {
                erc20.safeTransferFrom(from, address(revenueFurnace()), slice);
                revenueFurnace().respondToDeposit(erc20);
            } else if (addr_to  == ST_RSR) {
                erc20.safeTransferFrom(from, address(stRSR()), slice);
                stRSR().respondToDeposit(erc20);
            }
            erc20.safeTransferFrom(from, _destinations.at(i), slice);
        }
    }

    /// Returns the sum of all rsr cuts
    function rsrCut() public view returns (Fix) {
        (Fix rTokenTotal, Fix rsrTotal) = _totals();
        return rsrTotal.div(rsrTotal.plus(rTokenTotal));
    }

    /// Returns the sum of all rToken cuts
    function rTokenCut() public view returns (Fix) {
        return FIX_ONE.minus(rsrCut());
    }

    /// Returns the rsr + rToken totals
    function _totals() private view returns (Fix rTokenTotal, Fix rsrTotal) {
        for (uint256 i = 0; i < _destinations.length(); i++) {
            RevenueShare storage share = _distribution[_destinations.at(i)];
            rTokenTotal = rTokenTotal.plus(share.rTokenDist);
            rsrTotal = rsrTotal.plus(share.rsrDist);
        }
    }
}
