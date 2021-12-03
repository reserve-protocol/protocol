// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/libraries/Fixed.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/main/Mixin.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

contract RevenueTableP0 is Mixin, IRevenueTable
{
    using FixLib for Fix;
    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet addrs;
    mapping(address => Fix[2]) distribution;
    // Values: [RToken fraction, RSR fraction]
    // invariant: distribution values are all nonnegative, and at least one is nonzero.
    address constant FURNACE = address(1);
    address constant ST_RSR = address(2);

    function init(ConstructorArgs calldata args) public virtual override(Mixin) {
        super.init(args);
        // TODO: pull `cut` out of `config` in ConstructorArgs?
        addrs.add(FURNACE);
        distribution[FURNACE] = [FIX_ONE.minus(args.config.cut), FIX_ZERO];
        addrs.add(ST_RSR);
        distribution[ST_RSR] = [FIX_ZERO, args.config.cut];
    }

    // setters
    function add_destination(address dest, Fix rtokenFraction, Fix rsrFraction) public {
        addrs.add(dest);
        distribution[dest] = [rtokenFraction, rsrFraction];
    }

    // getters
    function rsr_cut() internal view returns (Fix){
        Fix rTokenTotal = FIX_ZERO;
        Fix rsrTotal = FIX_ZERO;
        for (uint256 i = 0; i < addrs.length(); i++) {
            Fix rTokenFraction = distribution[addrs.at(i)][0];
            Fix rsrFraction = distribution[addrs.at(i)][1];
            rTokenTotal = rTokenTotal.plus(rTokenFraction);
            rsrTotal = rsrTotal.plus(rsrFraction);
        }
        return rsrTotal.div(rsrTotal.plus(rTokenTotal));
    }

    function rtoken_cut() internal view returns (Fix){
        return FIX_ONE.minus(rsr_cut());
    }

    // summaries
    // helpers, if any
}
