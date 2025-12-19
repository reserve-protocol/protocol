// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/governance/TimelockController.sol";
import "../interfaces/IDeployer.sol";
import "../interfaces/IDistributor.sol";
import "../mixins/Versioned.sol";
import "../facade/lib/FacadeWriteLib.sol";
import "../plugins/assets/Asset.sol";
import "../plugins/assets/RTokenAsset.sol";
import "../plugins/governance/Governance.sol";
import "../p1/BasketHandler.sol";
import "../p1/Main.sol";

bytes32 constant MAIN_OWNER_ROLE = bytes32("OWNER");
bytes32 constant PAUSER_ROLE = bytes32("PAUSER");
bytes32 constant SHORT_FREEZER_ROLE = bytes32("SHORT_FREEZER");
bytes32 constant LONG_FREEZER_ROLE = bytes32("LONG_FREEZER");

bytes32 constant TIMELOCK_ADMIN_ROLE = keccak256("TIMELOCK_ADMIN_ROLE");
bytes32 constant PROPOSER_ROLE = keccak256("PROPOSER_ROLE");
bytes32 constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
bytes32 constant CANCELLER_ROLE = keccak256("CANCELLER_ROLE");

/**
 * The upgrade spell for the 4.2.0 release. Upgrading RToken must be on 3.4.0.
 *
 * Supported RTokens:
 *   Mainnet:
 *    - eUSD
 *    - ETH+
 *    - USD3
 *   Base:
 *    - hyUSD
 *    - bsdETH
 *
 * The spell can only be cast once per RToken.
 *
 * Before casting the spell this contract must have MAIN_OWNER_ROLE of Main.
 *
 * MAIN_OWNER_ROLE is automatically revoked after casting.
 *
 * The spell() function should be called by the timelock owning Main.
 *
 */
contract Upgrade4_2_0 is Versioned {
    using EnumerableSet for EnumerableSet.Bytes32Set;

    error Err(uint256 index);

    event NewGovernanceDeployed(
        IRToken indexed rToken,
        address indexed newGovernor,
        address indexed newTimelock
    );

    bytes32 public constant PRIOR_VERSION_HASH = keccak256(abi.encodePacked("3.4.0"));
    bytes32 public constant NEW_VERSION_HASH = keccak256(abi.encodePacked("4.2.0"));

    // ======================================================================================

    // 4.2.0 Assets (mainnet)
    Asset[55] MAINNET_ASSETS = [
        Asset(0xbCb71eE9c3372f3444cBBe3E1b263204967EdBE3), // RSR
        Asset(0xFDE702794298DB19e2a235782B82aD88053F7335), // stkAAVE
        Asset(0xA32a92073fEB7ed31081656DeFF34518FB5194b9), // COMP
        Asset(0x69841bA9E09019acA0d16Ae9c9724D25d51F6956), // CRV
        Asset(0x2635c3B92c8451F9D1e75BD61FCF87D1eCdf0ad0), // CVX
        Asset(0x8A782e182EeE2299B3DB733659ea764A5a97AdC5), // DAI
        Asset(0xDB665809eF5e2D8015c05504c242DDc2932AcDee), // USDC
        Asset(0xd717d722074C8dBfd0a29F73E4638cCc49C7D53D), // USDT
        Asset(0x4615C29BbA8b2Fa32906A594e922285a09301f42), // aDAI
        Asset(0x0D346E98CECa2Fd7DE7BE3F53737D82BDE932117), // aUSDC
        Asset(0x7B0E0081bf89E3307b3734d821D4297B33911C44), // aUSDT
        Asset(0x6394FE4995D03a2a463bae2C3A4406043dF760E8), // cDAI
        Asset(0x0072118C321181168E6643919074a0B518488637), // cUSDC
        Asset(0xcAF032D20d09CEa9727Aa1dDf6F4E4367155d05e), // cUSDT
        Asset(0xa58053D343299BD8818A70D5bfea0318Ca5ebEC5), // cWBTC
        Asset(0x00a07ac1b3f9C5f7aD4C6935b1Cb2028DebB6555), // cETH
        Asset(0x7437047523dAe8116a94EF5FFAAB3A657e5dC60E), // WBTC
        Asset(0x90c26f98cBE23666ED1E59186e1e4888512BE58d), // WETH
        Asset(0xF156B8b44941C6f9c1Fd4825b0C6e50ecFDECfC7), // wstETH
        Asset(0x81283be7aD5A6d6C4A085b4D694B127Ccf7E652E), // rETH
        Asset(0x73073c75ddaeC9Ce917f326e8fa860B8a773e5a3), // fUSDC
        Asset(0x169544B6422C6690457931259FAd8C0A76540A2E), // fUSDT
        Asset(0x79ed64e67B846E483594C496F05B25835e53c614), // fDAI
        Asset(0xBb7B4CAA808C9FA262095221299dbc873071CAF4), // fFRAX
        Asset(0x4D6F9A0F0F57A8179A146f37dD93D558073b814f), // cUSDCv3
        Asset(0xa52F93E61EdF1B77B2D680945F3EA4E84Bb825D3), // cUSDTv3
        Asset(0xE898cd20696fFE17489955101B97F3f9103B83aC), // cvx3Pool
        Asset(0xFDe02d56dec895f7769dC0505D98706f029738D2), // cvxPayPool
        Asset(0xcF9604276C6F4460CA7D1AA079826A138CFBb5c0), // cvxCrvUSDUSDC
        Asset(0x08c31bdAbCABDE22DAf07c816aB6FFc7c193Cd60), // cvxCrvUSDUSDT
        Asset(0xEB11916A884342ef772Ef2941F586c9a42Fd6Db4), // sDAI
        Asset(0x5ff1120487EE5668D224C8C28ca3d548de3d1417), // cbETH
        Asset(0x41A702f9F7e2fB89Ae7A58B71983187A779F4f02), // maUSDT
        Asset(0xAdd6044E6d927e9d0b60e01aea96F8653f386b0F), // maUSDC
        Asset(0x38C6F020ec71bDf13653E3D2dED8457295dD4DCa), // maDAI
        Asset(0x39e9b883185940101eeF200C507128f31Fa6f933), // maWBTC
        Asset(0xeF6bC7e7C964Df4E51e7754c43E4eC425b84c0fE), // maWETH
        Asset(0xfC74B3026A12Dfc421AB5ec2a1155dE14DcB63E2), // maStETH
        Asset(0x56bcd730040417b871CDf2549564EbB3C88730c9), // saEthUSDC
        Asset(0xd317b21d37B171F7821420cBE59eBfD3c1248200), // saEthUSDT
        Asset(0x6CeF509a76E0Fa99105fF618ae3Ef239eE000142), // saEthPyUSD
        Asset(0x47084e9F96CE9F17A46Ab92E1E29fA4a0592CAc3), // yvCurveUSDCcrvUSD
        Asset(0xbDEaddB62791f08BbB0c83E32f3A6c2a69cecBB3), // sFRAX
        Asset(0x71793f9e0A13CE361560aFa588aCFac9B525b1c1), // sfrxETH
        Asset(0xb1327EAd6ab9A1e363C4fC61648bD3131A587E39), // steakUSDC
        Asset(0xB106614aB25474d24861BB6b92AE7a9335ab8507), // steakPYUSD
        Asset(0xB462C68cBbF89E440B36073E104f646257afF1c6), // bbUSDT
        Asset(0xe8d05DB4aB6fCD3f261C990B8a592A9ba6A65e44), // Re7WETH
        Asset(0x9fc417439D8C12159A89962C28D8A8dED9EA9dde), // ETHx
        Asset(0x5A78da62a85099A3Da30e56F5dA8db95aFc63920), // apxETH
        Asset(0x403623175656ED0CDF1F9efE54867761F1EBf1D8), // sUSDe
        Asset(0x4FD189996b5344Eb4CF9c749b97C7424D399d24e), // sUSDS
        Asset(0xBFAc3e99263B7aE9704eC1c879f7c0a57C6b53e1), // wOETH
        Asset(0x9A65173df5D5B86E26300Cc9cA5Ff378be6DAeA5), // pyUSD
        Asset(0xb1e61f452CFcF6609C2F4088EC36B4c8dd1806b5) // saEthRLUSD
    ];

    // 4.2.0 Assets (base)
    Asset[20] BASE_ASSETS = [
        Asset(0x22018D85BFdA9e2673FB4101e957562a1e952Cdf), // RSR
        Asset(0xC9c37FC53682207844B058026024853A9C0b8c7B), // COMP
        Asset(0x7f7B77e49d5b30445f222764a794AFE14af062eB), // AERO
        Asset(0x3962695aCce0Efce11cFf997890f3D1D7467ec40), // STG
        Asset(0x49A44d50d3B1E098DAC9402c4aF8D0C0E499F250), // DAI
        Asset(0x33E840e5711549358f6d4D11F9Ab2896B36E9822), // USDC
        Asset(0xf003b8A8200F14db13f5F712EC8e76c41e7e9A7A), // USDbC
        Asset(0x2387C22727ACb91519b80A15AEf393ad40dFdb2F), // WETH
        Asset(0x14c443d8BdbE9A65F3a23FA4e199d8741D5B38Fa), // cbETH
        Asset(0x41edAFFB50CA1c2FEC86C629F845b8490ced8A2c), // cUSDCv3
        Asset(0xa9F0eca90B5d4f213f8119834E0920785bb70F46), // saBasUSDC
        Asset(0x9b2A9bAeB8F1930fC2AF9b7Fa473edF2B8c3B549), // wstETH
        Asset(0x97F9d5ed17A0C99B279887caD5254d15fb1B619B), // aeroUSDCeUSD
        Asset(0xee587c5C262824b9423e73303dFf270EcE5074c9), // aeroWETHAERO
        Asset(0x719fbae9e2Dcd525bCf060a8D5DBC6C9fE104A50), // aeroMOGWETH
        Asset(0x171034eFCA7349E4D1944d179ccf52277D1CA6c9), // aeroWETHcbBTC
        Asset(0x5Cb6656970B21d51c0885C3831A14010d3fBF5Ed), // aeroWETHWELL
        Asset(0xb56aa995Ab51f32885C72aA825BEa7559c06a72f), // aeroWETHDEGEN
        Asset(0x9CB8fac0d43468068DaB561e7797cE3747624A21), // meUSD
        Asset(0x878b995bDD2D9900BEE896Bd78ADd877672e1637) // wsuperOETHb
    ];

    // ======================================================================================

    IDeployer.Registries public registries;

    IDeployer public deployer;

    struct NewGovernance {
        IGovernor anastasius;
        TimelockController timelock;
    }

    // RToken => [IGovernor, TimelockController]
    mapping(IRToken => NewGovernance) public newGovs;

    // ERC20 => 4.2.0 Asset
    mapping(IERC20 => Asset) public assets;

    // RToken => bool
    mapping(IRToken => bool) public supported;

    // RToken => bool
    mapping(IRToken => bool) public cast;

    bool public mainnet; // !mainnet | base

    // =======================================================================================

    constructor(bool _mainnet) {
        // we have to pass-in `_mainnet` because chainid is not reliable during testing
        require(block.chainid == 1 || block.chainid == 31337 || block.chainid == 8453, Err(0));
        mainnet = _mainnet;

        if (_mainnet) {
            // 4.2.0 deployer (mainnet)
            deployer = IDeployer(0x8FcbD0BaaeB442F1f3F374FcB63933e6D4Cb8710);
            require(keccak256(abi.encodePacked(deployer.version())) == NEW_VERSION_HASH, Err(1));

            // DAO registries (mainnet)
            registries = IDeployer.Registries(
                VersionRegistry(0x1895b15B3d0a70962be86Af0E337018aD63464e0),
                AssetPluginRegistry(0x4a818c41131CB9FE65BadF2Bb8671dDE4D117135),
                DAOFeeRegistry(0xec716deD4eABa060937D1a915F166E237039342B),
                ITrustedFillerRegistry(0x279ccF56441fC74f1aAC39E7faC165Dec5A88B3A)
            );

            // Setup `supported`
            supported[IRToken(0xA0d69E286B938e21CBf7E51D71F6A4c8918f482F)] = true; // eUSD
            supported[IRToken(0xE72B141DF173b999AE7c1aDcbF60Cc9833Ce56a8)] = true; // ETH+
            supported[IRToken(0x0d86883FAf4FfD7aEb116390af37746F45b6f378)] = true; // USD3

            // Setup `assets`
            for (uint256 i = 0; i < MAINNET_ASSETS.length; i++) {
                require(
                    keccak256(abi.encodePacked(MAINNET_ASSETS[i].version())) == NEW_VERSION_HASH,
                    Err(1)
                );

                IERC20 erc20 = MAINNET_ASSETS[i].erc20();
                require(address(assets[erc20]) == address(0), Err(2));
                assets[erc20] = MAINNET_ASSETS[i];
            }
        } else {
            // 4.2.0 deployer (base)
            deployer = IDeployer(0x5705F85A05c8b57818663C7AB6a11f88323a1A57);
            require(keccak256(abi.encodePacked(deployer.version())) == NEW_VERSION_HASH, Err(1));

            // DAO registries (base)
            registries = IDeployer.Registries(
                VersionRegistry(0xBbC532A80DD141449330c1232C953Da6801Aed01),
                AssetPluginRegistry(0x7Ac954307356301A10adDb0dB4f61b4a475d3551),
                DAOFeeRegistry(0x3513D2c7D2F51c678889CeC083E7D7Ae27b219aD),
                ITrustedFillerRegistry(0x72DB5f49D0599C314E2f2FEDf6Fe33E1bA6C7A18)
            );

            // Setup `supported`
            supported[IRToken(0xCc7FF230365bD730eE4B352cC2492CEdAC49383e)] = true; // hyUSD (base)
            supported[IRToken(0xCb327b99fF831bF8223cCEd12B1338FF3aA322Ff)] = true; // bsdETH

            // Setup `assets`
            for (uint256 i = 0; i < BASE_ASSETS.length; i++) {
                require(
                    keccak256(abi.encodePacked(BASE_ASSETS[i].version())) == NEW_VERSION_HASH,
                    Err(3)
                );

                IERC20 erc20 = BASE_ASSETS[i].erc20();
                require(address(assets[erc20]) == address(0), Err(4));
                assets[erc20] = BASE_ASSETS[i];
            }
        }
    }

    // Cast once-per-rToken. Caller MUST be the timelock owning Main.
    /// @dev Requirement: this contract has admin of RToken via MAIN_OWNER_ROLE
    /// @param rToken The RToken to upgrade
    /// @param oldGovernor The old governor contract in charge of the timelock
    /// @param guardians Guardians to use for the new governance, MUST be a subset of old guardians
    function castSpell(
        IRToken rToken,
        Governance oldGovernor,
        address[] calldata guardians
    ) external returns (address newGovernor, address newTimelock) {
        require(keccak256(abi.encodePacked(rToken.version())) == PRIOR_VERSION_HASH, Err(6));

        // Can only be cast once per supported RToken
        require(supported[rToken] && !cast[rToken], Err(6));
        cast[rToken] = true;

        MainP1 main = MainP1(address(rToken.main()));
        require(main.hasRole(MAIN_OWNER_ROLE, msg.sender), Err(7)); // security crux
        require(main.hasRole(MAIN_OWNER_ROLE, address(this)), Err(8));

        Components memory proxy;
        proxy.assetRegistry = main.assetRegistry();
        proxy.basketHandler = main.basketHandler();
        proxy.backingManager = main.backingManager();
        proxy.broker = main.broker();
        proxy.distributor = main.distributor();
        proxy.furnace = main.furnace();
        proxy.rToken = rToken;
        proxy.rTokenTrader = main.rTokenTrader();
        proxy.rsrTrader = main.rsrTrader();
        proxy.stRSR = main.stRSR();

        // Main + Component upgrades
        {
            Implementations memory impls = deployer.implementations();

            // Upgrade Main
            main.upgradeTo(address(impls.main));
            require(keccak256(abi.encodePacked(main.version())) == NEW_VERSION_HASH, Err(9));

            // Set registries
            // reverts on zero address
            main.setVersionRegistry(VersionRegistry(registries.versionRegistry));
            main.setAssetPluginRegistry(AssetPluginRegistry(registries.assetPluginRegistry));
            main.setDAOFeeRegistry(DAOFeeRegistry(registries.daoFeeRegistry));

            // Grant OWNER to Main -- needed to upgrade components
            main.grantRole(MAIN_OWNER_ROLE, address(main));

            // Upgrade components
            main.upgradeRTokenTo(NEW_VERSION_HASH, false, false);
            main.cacheComponents();

            // Verify all components are upgraded
            require(
                keccak256(abi.encodePacked(proxy.assetRegistry.version())) == NEW_VERSION_HASH &&
                    keccak256(abi.encodePacked(proxy.basketHandler.version())) ==
                    NEW_VERSION_HASH &&
                    keccak256(abi.encodePacked(proxy.backingManager.version())) ==
                    NEW_VERSION_HASH &&
                    keccak256(abi.encodePacked(proxy.broker.version())) == NEW_VERSION_HASH &&
                    keccak256(abi.encodePacked(proxy.distributor.version())) == NEW_VERSION_HASH &&
                    keccak256(abi.encodePacked(proxy.furnace.version())) == NEW_VERSION_HASH &&
                    keccak256(abi.encodePacked(proxy.rToken.version())) == NEW_VERSION_HASH &&
                    keccak256(abi.encodePacked(proxy.rTokenTrader.version())) == NEW_VERSION_HASH &&
                    keccak256(abi.encodePacked(proxy.rsrTrader.version())) == NEW_VERSION_HASH &&
                    keccak256(abi.encodePacked(proxy.stRSR.version())) == NEW_VERSION_HASH,
                Err(11)
            );

            // Revoke OWNER from Main
            main.revokeRole(MAIN_OWNER_ROLE, address(main));
            require(!main.hasRole(MAIN_OWNER_ROLE, address(main)), Err(12));

            // Turn on trusted fills
            TestIBroker(address(proxy.broker)).setTrustedFillerRegistry(
                address(registries.trustedFillerRegistry),
                true
            );

            // Keep issuance premium off, should be off by default
            require(
                !TestIBasketHandler(address(proxy.basketHandler)).enableIssuancePremium(),
                Err(13)
            );

            // Verify trading plugins are updated
            require(
                address(TestIBroker(address(proxy.broker)).dutchTradeImplementation()) ==
                    address(impls.trading.dutchTrade) &&
                    address(TestIBroker(address(proxy.broker)).batchTradeImplementation()) ==
                    address(impls.trading.gnosisTrade),
                Err(14)
            );
        }

        // Distributor invariant: table must sum to >=10000
        {
            RevenueTotals memory revTotals = proxy.distributor.totals();
            require(revTotals.rTokenTotal + revTotals.rsrTotal >= MAX_DISTRIBUTION, Err(13));
        }

        // Rotate assets, erc20s should not change
        {
            IERC20[] memory erc20s = proxy.assetRegistry.erc20s();

            for (uint256 i = 0; i < erc20s.length; i++) {
                IERC20 erc20 = erc20s[i];

                if (assets[erc20] != Asset(address(0)) && address(erc20) != address(rToken)) {
                    // if we have a new asset with that erc20, swapRegistered()
                    proxy.assetRegistry.swapRegistered(assets[erc20]);
                }
            }

            // Rotate RTokenAsset
            require(
                proxy.assetRegistry.registerNewRTokenAsset(
                    proxy.assetRegistry.toAsset(IERC20(address(rToken))).maxTradeVolume()
                ),
                Err(17)
            );

            // Validate all assets
            proxy.assetRegistry.validateCurrentAssets();

            // Refresh basket
            proxy.basketHandler.refreshBasket();
            require(proxy.basketHandler.status() == CollateralStatus.SOUND, Err(18));
        }

        // Deploy new governance, preserving all values
        {
            TimelockController oldTimelock = TimelockController(payable(msg.sender));

            uint256 minDelay = oldTimelock.getMinDelay();
            require(minDelay != 0, Err(19));

            // Deploy new timelock
            newTimelock = address(
                new TimelockController(minDelay, new address[](0), new address[](0), address(this))
            );

            // Deploy new governor
            newGovernor = FacadeWriteLib.deployGovernance(
                IStRSRVotes(address(oldGovernor.token())),
                TimelockController(payable(newTimelock)),
                oldGovernor.votingDelay(),
                oldGovernor.votingPeriod(),
                1e4, // all previous governors are set to 0.01%
                oldGovernor.quorumNumerator()
            );
            require(Governance(payable(newGovernor)).timelock() == newTimelock, Err(20));

            TimelockController _newTimelock = TimelockController(payable(newTimelock));

            // timelock roles
            _newTimelock.grantRole(CANCELLER_ROLE, newGovernor); // Gov can cancel
            _newTimelock.grantRole(PROPOSER_ROLE, newGovernor); // Gov only proposer
            _newTimelock.grantRole(EXECUTOR_ROLE, newGovernor); // Gov only executor

            for (uint256 i = 0; i < guardians.length; i++) {
                require(oldTimelock.hasRole(CANCELLER_ROLE, guardians[i]), Err(21));
                _newTimelock.grantRole(CANCELLER_ROLE, guardians[i]); // Guardian can cancel
                require(_newTimelock.hasRole(CANCELLER_ROLE, guardians[i]), Err(22));
            }

            _newTimelock.revokeRole(TIMELOCK_ADMIN_ROLE, address(this)); // Revoke admin role
            require(!_newTimelock.hasRole(TIMELOCK_ADMIN_ROLE, address(this)), Err(22));

            // post validation
            require(
                _newTimelock.hasRole(PROPOSER_ROLE, newGovernor) &&
                    _newTimelock.hasRole(EXECUTOR_ROLE, newGovernor) &&
                    _newTimelock.hasRole(CANCELLER_ROLE, newGovernor),
                Err(22)
            );

            require(
                !_newTimelock.hasRole(PROPOSER_ROLE, address(oldGovernor)) &&
                    !_newTimelock.hasRole(EXECUTOR_ROLE, address(oldGovernor)) &&
                    !_newTimelock.hasRole(CANCELLER_ROLE, address(oldGovernor)),
                Err(23)
            );

            require(
                !_newTimelock.hasRole(PROPOSER_ROLE, address(0)) &&
                    !_newTimelock.hasRole(EXECUTOR_ROLE, address(0)) &&
                    !_newTimelock.hasRole(CANCELLER_ROLE, address(0)),
                Err(24)
            );

            // setup `newGovs` for rToken, only used in testing but useful for onchain record
            newGovs[rToken] = NewGovernance(
                IGovernor(payable(newGovernor)),
                TimelockController(payable(newTimelock))
            );
            emit NewGovernanceDeployed(rToken, newGovernor, newTimelock);
        }

        // Renounce adminships and validate final state
        {
            assert(oldGovernor.timelock() == msg.sender);

            main.grantRole(MAIN_OWNER_ROLE, newTimelock);
            main.revokeRole(MAIN_OWNER_ROLE, msg.sender);
            main.revokeRole(PAUSER_ROLE, msg.sender);
            main.revokeRole(SHORT_FREEZER_ROLE, msg.sender);
            main.revokeRole(LONG_FREEZER_ROLE, msg.sender);
            main.renounceRole(MAIN_OWNER_ROLE, address(this));

            require(
                main.hasRole(MAIN_OWNER_ROLE, newTimelock) &&
                    !main.hasRole(MAIN_OWNER_ROLE, msg.sender) &&
                    !main.hasRole(PAUSER_ROLE, msg.sender) &&
                    !main.hasRole(SHORT_FREEZER_ROLE, msg.sender) &&
                    !main.hasRole(LONG_FREEZER_ROLE, msg.sender) &&
                    !main.hasRole(MAIN_OWNER_ROLE, address(this)),
                Err(25)
            );

            require(
                !main.hasRole(MAIN_OWNER_ROLE, address(oldGovernor)) &&
                    !main.hasRole(MAIN_OWNER_ROLE, newGovernor),
                Err(26)
            );
        }
    }
}
