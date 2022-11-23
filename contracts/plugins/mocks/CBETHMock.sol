// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;
//import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "./ERC20Mock.sol";
import "contracts/libraries/Fixed.sol";

/// Coinbase StakedTokenV1 Mock
/// @dev ERC20 + Oracle functions + exchange rate function
/// @dev see https://github.com/coinbase/wrapped-tokens-os/blob/main/contracts/wrapped-tokens/staking/StakedTokenV1.sol
contract StakedTokenV1Mock is ERC20Mock {
    using FixLib for uint192;

    bytes32 private constant _EXCHANGE_RATE_ORACLE_POSITION = keccak256(
        "org.coinbase.stakedToken.exchangeRateOracle"
    );
    /**
     * @dev Storage slot with the current exchange rate.
     * This is the keccak-256 hash of "org.coinbase.stakedToken.exchangeRate"
     */
    bytes32 private constant _EXCHANGE_RATE_POSITION = keccak256(
        "org.coinbase.stakedToken.exchangeRate"
    );

    address public masterMinter;
    mapping(address => bool) internal minters;
    mapping(address => uint256) internal minterAllowed;

    event OracleUpdated(address indexed newOracle);
    event ExchangeRateUpdated(address indexed oracle, uint256 newExchangeRate);
     event MinterConfigured(address indexed minter, uint256 minterAllowedAmount);

    modifier onlyOracle() {
        require(msg.sender == oracle(), "StakedTokenV1Mock: caller is not the oracle");
        _;
    }

    constructor(
        string memory name,
        string memory symbol,
        address _oracle,
        uint256 _exchangeRate
    ) ERC20Mock(name, symbol) {
        require(
            _oracle != address(0),
            "StakedTokenV1: oracle is the zero address"
        );
        bytes32 position = _EXCHANGE_RATE_ORACLE_POSITION;
        assembly {
            sstore(position, _oracle)
        }
        require(
            _exchangeRate > 0,
            "StakedTokenV1: new exchange rate cannot be 0"
        );
        position = _EXCHANGE_RATE_POSITION;
        assembly {
            sstore(position, _exchangeRate)
        }
    }

    /// @dev Returns ERC20 decimals => 18 for coin base StakedTokenV1
    function decimals() public pure override returns (uint8) {
        return 18;
    }

    /**
     * @dev Returns the current exchange rate scaled by by 10**18
     * @return _exchangeRate The exchange rate
     */
    function exchangeRate() public view returns (uint256 _exchangeRate) {
        bytes32 position = _EXCHANGE_RATE_POSITION;
        assembly {
            _exchangeRate := sload(position)
        }
    }

    /**
     * @dev Function to update the exchange rate
     * @param newExchangeRate The new exchange rate
     */
    function updateExchangeRate(uint256 newExchangeRate) external onlyOracle {
        require(
            newExchangeRate > 0,
            "StakedTokenV1: new exchange rate cannot be 0"
        );
        bytes32 position = _EXCHANGE_RATE_POSITION;
        assembly {
            sstore(position, newExchangeRate)
        }
        emit ExchangeRateUpdated(msg.sender, newExchangeRate);
    }

    function updateOracle(address newOracle) external onlyOracle {
        require(
            newOracle != address(0),
            "StakedTokenV1: oracle is the zero address"
        );
        require(
            newOracle != oracle(),
            "StakedTokenV1: new oracle is already the oracle"
        );
        bytes32 position = _EXCHANGE_RATE_ORACLE_POSITION;
        assembly {
            sstore(position, newOracle)
        }
        emit OracleUpdated(newOracle);
    }

    function oracle() public view returns (address _oracle) {
        bytes32 position = _EXCHANGE_RATE_ORACLE_POSITION;
        assembly {
            _oracle := sload(position)
        }
    }

    /**
     * @dev Function to add/update a new minter
     * @param minter The address of the minter
     * @param minterAllowedAmount The minting amount allowed for the minter
     * @return True if the operation was successful.
     */
    function configureMinter(address minter, uint256 minterAllowedAmount)
        external
        returns (bool)
    {
        minters[minter] = true;
        minterAllowed[minter] = minterAllowedAmount;
        emit MinterConfigured(minter, minterAllowedAmount);
        return true;
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
