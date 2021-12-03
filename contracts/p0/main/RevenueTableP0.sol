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

contract RevenueTableP0 is Ownable, Mixin, SettingsHandlerP0, IRevenueTable {
    using SafeERC20 for IERC20;
    using FixLib for Fix;
    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet private _addrs;
    mapping(address => Fix[2]) private _distribution;
    // Values: [RToken fraction, RSR fraction]
    // invariant: distribution values are all nonnegative, and at least one is nonzero.

    address constant FURNACE = address(1);
    address constant ST_RSR = address(2);

    function init(ConstructorArgs calldata args) public virtual override(Mixin, SettingsHandlerP0) {
        super.init(args);
        // TODO: pull `cut` out of `config` in ConstructorArgs?
        setDistribution(FURNACE, FIX_ONE.minus(args.config.cut), FIX_ZERO);
        setDistribution(ST_RSR, FIX_ZERO, args.config.cut);
    }

    function setDistribution(
        address dest,
        Fix rTokenFraction,
        Fix rsrFraction
    ) public override onlyOwner {
        _addrs.add(dest);
        _distribution[dest] = [rTokenFraction, rsrFraction];
    }

    /// Requires an allowance
    function distribute(
        IERC20 erc20,
        address from,
        uint256 amount
    ) external override {
        require(erc20 == rsr() || erc20 == rToken(), "RSR or RToken");
        (Fix rTokenTotal, Fix rsrTotal) = _totals();
        Fix total = erc20 == rsr() ? rsrTotal : rTokenTotal;
        uint256 index = erc20 == rsr() ? 1 : 0;
        for (uint256 i = 0; i < _addrs.length(); i++) {
            Fix slice = _distribution[_addrs.at(i)][index].mulu(amount).div(total);
            erc20.safeTransferFrom(from, _addrs.at(i), slice.toUint());
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
        for (uint256 i = 0; i < _addrs.length(); i++) {
            Fix rTokenFraction = _distribution[_addrs.at(i)][0];
            Fix rsrFraction = _distribution[_addrs.at(i)][1];
            rTokenTotal = rTokenTotal.plus(rTokenFraction);
            rsrTotal = rsrTotal.plus(rsrFraction);
        }
    }
}
