// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.0;

import "../../libraries/CompoundMath.sol";

contract CompoundMathEchidnaTest {
    function compoundForZeroTimedelta(uint256 scale, uint256 compoundRate) public pure {
        require(scale == 1e18);
        uint256 _res = CompoundMath.compound(scale, compoundRate, 0);
        assert(_res == scale);
    }

    // function compoundForUnitRate(uint256 scale, uint256 timedelta) public pure {
    //     require(scale == 1e18);
    //     uint256 _res = CompoundMath.compound(scale, 1, timedelta);
    //     assert(_res == 1);
    // }
}

