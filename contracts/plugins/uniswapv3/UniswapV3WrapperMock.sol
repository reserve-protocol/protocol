// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.9;

import { UniswapV3Wrapper } from "./UniswapV3Wrapper.sol";

/**
    @title Uniswap V3 Wrapper
    @notice ERC20 Wrapper token for Uniswap V3 positions
    @author Gene A. Tsvigun
    @author Vic G. Larson
  */
contract UniswapV3WrapperMock is UniswapV3Wrapper {
    struct Values {
        uint256 feesAmount0;
        uint256 feesAmount1;
    }

    Values values;

    constructor(string memory name_, string memory symbol_) UniswapV3Wrapper(name_, symbol_) {}

    function _fees() internal view override returns (uint256 feesAmount0, uint256 feesAmount1) {
        return (values.feesAmount0, values.feesAmount1);
    }

    function updateUser(address user) public {
        _updateUser(user);
    }

    function unclaimedRewards0(address user) public view returns (uint256) {
        return _unclaimedRewards0[user];
    }

    function unclaimedRewards1(address user) public view returns (uint256) {
        return _unclaimedRewards1[user];
    }

    function setFees(uint256 feesAmount0, uint256 feesAmount1) public  {
        values.feesAmount0 = feesAmount0;
        values.feesAmount1 = feesAmount1;
    }


}
