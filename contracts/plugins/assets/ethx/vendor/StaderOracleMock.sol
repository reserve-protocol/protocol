// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "./IStaderConfig.sol";
import "./IStaderOracle.sol";
import "./IStaderStakePoolManager.sol";

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

contract StaderOracleMock is
    IStaderOracle,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    bool public erInspectionMode;
    bool public isPORFeedBasedERData;
    SDPriceData public lastReportedSDPriceData;
    IStaderConfig public staderConfig;
    ExchangeRate public inspectionModeExchangeRate;
    ExchangeRate public exchangeRate;
    ValidatorStats public validatorStats;

    uint256 public constant MAX_ER_UPDATE_FREQUENCY = 7200 * 7; // 7 days
    uint256 public constant ER_CHANGE_MAX_BPS = 10000;
    uint256 public erChangeLimit;
    uint256 public constant MIN_TRUSTED_NODES = 5;
    uint256 public trustedNodeChangeCoolingPeriod;

    uint256 public trustedNodesCount;
    uint256 public lastReportedMAPDIndex;
    uint256 public erInspectionModeStartBlock;
    uint256 public lastTrustedNodeCountChangeBlock;

    // indicate the health of protocol on beacon chain
    // enabled by `MANAGER` if heavy slashing on protocol on beacon chain
    bool public safeMode;

    mapping(address => bool) public isTrustedNode;
    mapping(bytes32 => bool) private nodeSubmissionKeys;
    mapping(bytes32 => uint8) private submissionCountKeys;
    mapping(bytes32 => uint16) public missedAttestationPenalty;
    mapping(uint8 => uint256) public lastReportingBlockNumberForWithdrawnValidatorsByPoolId;
    mapping(uint8 => uint256) public lastReportingBlockNumberForValidatorVerificationDetailByPoolId;

    uint256[] private sdPrices;

    bytes32 public constant ETHX_ER_UF = keccak256("ETHX_ER_UF");
    bytes32 public constant SD_PRICE_UF = keccak256("SD_PRICE_UF");
    bytes32 public constant VALIDATOR_STATS_UF = keccak256("VALIDATOR_STATS_UF");
    bytes32 public constant WITHDRAWN_VALIDATORS_UF = keccak256("WITHDRAWN_VALIDATORS_UF");
    bytes32 public constant MISSED_ATTESTATION_PENALTY_UF =
        keccak256("MISSED_ATTESTATION_PENALTY_UF");
    // Ready to Deposit Validators Update Frequency Key
    bytes32 public constant VALIDATOR_VERIFICATION_DETAIL_UF =
        keccak256("VALIDATOR_VERIFICATION_DETAIL_UF");
    mapping(bytes32 => uint256) public updateFrequencyMap;

    function getExchangeRate() external view override returns (ExchangeRate memory) {
        return (exchangeRate);
    }

    // Mock function to be able to override rate in tests
    function setExchangeRate(ExchangeRate memory newExchangeRate) external {
        exchangeRate = newExchangeRate;
    }
}
