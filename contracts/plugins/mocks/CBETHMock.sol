// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;
//import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "./ERC20Mock.sol";
import "contracts/libraries/Fixed.sol";
import "hardhat/console.sol";

/// Coinbase StakedTokenV1 Mock
/// @dev ERC20 + Oracle functions + exchange rate function
/// @dev see https://github.com/coinbase/wrapped-tokens-os/blob/main/contracts/wrapped-tokens/staking/StakedTokenV1.sol
contract StakedTokenV1Mock is ERC20Mock {
    using FixLib for uint192;

    uint256 internal EXCHANGE_RATE;
    address internal EXCHANGE_RATE_ORACLE;

    event OracleUpdated(address indexed newOracle);
    event ExchangeRateUpdated(address indexed oracle, uint256 newExchangeRate);

    modifier onlyOracle() {
        require(msg.sender == EXCHANGE_RATE_ORACLE, "StakedTokenV1Mock: caller is not the oracle");
        _;
    }

    constructor(
        string memory name,
        string memory symbol,
        address _oracle,
        uint256 _exchangeRate
    ) ERC20Mock(name, symbol) {
        EXCHANGE_RATE_ORACLE = _oracle;
        EXCHANGE_RATE = _exchangeRate;
    }

    /// @dev Returns ERC20 decimals => 18 for coin base StakedTokenV1
    function decimals() public pure override returns (uint8) {
        return 18;
    }

    /// @dev Returns the current exchange rate scaled by by 10**18
    function exchangeRate() external view returns (uint256) {
        return EXCHANGE_RATE;
    }

    /**
     * @dev Function to update the exchange rate
     * @param newExchangeRate The new exchange rate
     */
    function updateExchangeRate(uint256 newExchangeRate) external onlyOracle {
        require(newExchangeRate > 0, "StakedTokenV1Mock: new exchange rate cannot be 0");
        console.log("from cbEth rcv: " , newExchangeRate);
        EXCHANGE_RATE = newExchangeRate;
        emit ExchangeRateUpdated(msg.sender, newExchangeRate);
    }

    function updateOracle(address newExOracle) external onlyOracle {
        require(newExOracle != address(0), "StakedTokenV1Mock: oracle is the zero address");
        require(newExOracle != EXCHANGE_RATE_ORACLE,  "StakedTokenV1Mock: new oracle is already the oracle");
        EXCHANGE_RATE_ORACLE = newExOracle;
        emit OracleUpdated(newExOracle);
    }
}

/// cbETH Mock contract
/// @dev see coinbase contract 0xBe9895146f7AF43049ca1c1AE358B0541Ea49704
/// @dev https://etherscan.io/address/0xBe9895146f7AF43049ca1c1AE358B0541Ea49704#readProxyContract
contract CBEthMock is StakedTokenV1Mock {
    constructor(address _ex_oracle, uint192 _exchangeRate)
        StakedTokenV1Mock("Coinbase Wrapped Staked ETH", "cbETHToken", _ex_oracle, _exchangeRate)
    {}
}
