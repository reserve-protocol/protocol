pragma solidity 0.8.4;

library Basket {

    struct CollateralToken {
        address address;
        uint256 genesisQuantity;
        uint256 quantity;
        uint256 sellRatePerBlock;
        uint256 minBuyRatePerBlock; // minimum quantity of token necessary to buy `sellRatePerBlock` tokens
    }

    struct Info {
        uint256 timestampInitialized;
        CollateralToken[] tokens;
    }

    /// Adjusts the quantities downwards based on how much supply expansion should have happened
    function update(Basket.Info storage self) internal {
        uint256 scaledRate = SCALE + supplyExpansionRateScaled * (block.timestamp - self.timestampInitialized) / 31536000;
        for (uint32 i = 0; i < self.tokens.length; i++) {
            self.tokens[i].quantity = self.tokens[i].genesisQuantity * SCALE / scaledRate;
        }
    }

}
