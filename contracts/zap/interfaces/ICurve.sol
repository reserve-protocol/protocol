pragma solidity 0.8.9;

interface ICurve {
    function exchange(
        int128 _from,
        int128 _to,
        uint256 _fromAmount,
        uint256 _minToAmount
    ) external;
}
