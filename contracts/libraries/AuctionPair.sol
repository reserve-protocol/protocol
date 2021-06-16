pragma solidity 0.8.4;

library AuctionPair {

    struct Info {
        address sellingToken;
        address buyingToken;
        mapping(address => uint256) balances;
        mapping(address => uint256) offers; // per-block
    }


    function get(
        mapping(bytes32 => Info) storage self,
        address sellingToken,
        address buyingToken,
    ) internal view returns (AuctionPair.Info storage pair) {
        pair = self[keccak256(abi.encodePacked(sellingToken, auctionToken))];
    }
}
