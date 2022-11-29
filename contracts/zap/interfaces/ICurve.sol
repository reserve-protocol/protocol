pragma solidity 0.8.9;

interface ICurve {
    function exchange(
        int128 _from,
        int128 _to,
        uint256 _from_amount,
        uint256 _min_to_amount
    ) external;
}
