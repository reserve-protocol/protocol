pragma solidity 0.8.4;

import "../zeppelin/access/Ownable.sol";
import "../zeppelin/token/IERC20.sol";

// Owned by TimelockController
contract Settings is Ownable {

    /// ==== Structs ====

    struct AuctionLimits {
        uint256 upper;
        uint256 lower;
    }

    struct CollateralToken {
        address address;
        uint256 quantity;
        AuctionLimits auctionLimits;
    }

    struct Parameters {

        /// Auction length (s)
        /// e.g. 86_400 => An auction lasts 24 hours
        uint32 auctionLength;

        /// Auction spacing (s)
        /// e.g. 21_600 => Auctions can be up to 6h from each other
        uint32 auctionSpacing;

        /// RSR staking deposit delay (s)
        /// e.g. 2_592_000 => Newly staked RSR tokens take 1 month to earn the right to vote.
        uint32 rsrDepositDelay;

        /// RSR staking withdrawal delay (s)
        /// e.g. 2_592_000 => Currently staking RSR tokens take 1 month to withdraw
        uint32 rsrWithdrawalDelay;

        /// RToken max supply
        /// e.g. 1_000_000e18 => 1M max supply
        uint256 maxSupply;

        /// RToken supply-expansion rate
        /// e.g. 1.23e16 => 1.23% annually
        uint256 supplyExpansionRate;

        /// RToken revenue batch sizes
        /// e.g. 1e15 => 0.1% of the RToken supply
        uint256 revenueBatchSize;

        /// Protocol expenditure factor
        /// e.g. 1e16 => 1% of the RToken supply expansion goes to expenditures
        uint256 expenditureFactor;

        /// Issuance/Redemption spread
        /// e.g. 1e14 => 0.01% spread
        uint256 spread; 

        /// RToken issuance blocklimit
        /// e.g. 25_000e18 => 25_000e18 (atto)RToken can be issued per block
        uint256 issuanceBlockLimit;

        /// Global Settlement (in RSR)
        /// e.g. 100_000_000e18 => 100M RSR
        uint256 globalSettlement;

        /// RSR auction limits
        AuctionLimits rsrAuctionLimits;

        /// Addresses
        address rsrTokenAddress;
        address circuitBreakerAddress;
        address txFeeAddress;
        address rsrStakingAddress;
        address batchAuctionAddress;
        address outgoingExpendituresAddress;
    }

    /// ==== State ====

    CollateralToken[] public override basket;
    Parameters public override parameters;

    constructor(CollateralToken[] calldata _basket, Parameters calldata _parameters) {
        basket = _basket;
        parameters = _parameters;
    }

    /// ==== Externals ====

    function upgradeBasket(CollateralToken[] calldata _basket) external override onlyOwner {
        basket = _basket;
    }

    function upgradeParameters(Parameters calldata _parameters) external override onlyOwner {
        parameters = _parameters;
    }

}
