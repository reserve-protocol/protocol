// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

interface IBooster {
    function poolInfo(uint256 _pid)
        external
        view
        returns (
            address _lptoken,
            address _token,
            address _gauge,
            address _crvRewards,
            address _stash,
            bool _shutdown
        );
}
