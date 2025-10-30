// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

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
bytes32 constant TIMELOCK_ADMIN_ROLE = keccak256("TIMELOCK_ADMIN_ROLE");
bytes32 constant PROPOSER_ROLE = keccak256("PROPOSER_ROLE");
bytes32 constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
bytes32 constant CANCELLER_ROLE = keccak256("CANCELLER_ROLE");

/**
 * The upgrade spell for the 4.2.0 release. Upgrading RToken must be on 3.4.0.
 *
 * RTokenes supported:
 *   Mainnet:
 *    - eUSD
 *    - ETH+
 *    - hyUSD
 *    - USD3
 *    - dgnETH
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

    error TestError();

    bytes32 public constant PRIOR_VERSION_HASH = keccak256(abi.encodePacked("3.4.0"));
    bytes32 public constant NEW_VERSION_HASH = keccak256(abi.encodePacked("4.2.0"));

    // ======================================================================================

    // 4.2.0 Assets (mainnet)
    Asset[56] MAINNET_ASSETS = [
        Asset(0xbCb71eE9c3372f3444cBBe3E1b263204967EdBE3), // RSR
        Asset(0xFb56B651f882f8f90d35DD7ca181A7F4D889ECac), // stkAAVE
        Asset(0x70C8611F5e34266c09c896f3547D1f7Fccf44D54), // COMP
        Asset(0x1942270ac94E6C6041C7F7c87562Ba8dDB1bDFFc), // CRV
        Asset(0x2362A9B237e4f06491B7E3827eE179b77f2B22c6), // CVX
        Asset(0xb90FE39CB47c4401A941528769f107dEe8e49488), // DAI
        Asset(0x3A078799a9823cBda084a79c7cAF47f499c6EA09), // USDC
        Asset(0xD8A1b8e73DC025C527493436057f0d8Fc01E1973), // USDT
        Asset(0x3A395c1bC233D43d126a971b15D8c2b6eB803ca6), // aDAI
        Asset(0xD1A2a985a18ddf30299cF2bDd0592B29e0AA3e84), // aUSDC
        Asset(0x723e269D178E887E1691f3cEe71c840B5C5b9F76), // aUSDT
        Asset(0x8487278d9262B9Dcca4beC85B125A45608d0067A), // cDAI
        Asset(0x9A84c6F204209957ddA0064EaeAAf6138fDb8cea), // cUSDC
        Asset(0xf35FbE1576E9D52c20B7ef8626477DcFb939d9Ef), // cUSDT
        Asset(0x3484EFB04a54bF376da091f4364F4961F7a01B74), // cWBTC
        Asset(0xe3dA655331649B86BfE3356beD99258083599543), // cETH
        Asset(0xcC07EF5FDafa6298b276f14A6F4198317D0d20c3), // WBTC
        Asset(0x868dbBD8B7d1AED1fEc4c13cc4a15f50965E2FB9), // WETH
        Asset(0xc915f28D1Cd97703cF0940ABB192EE50dD882f8c), // wstETH
        Asset(0x02D960943E1dD3B2c4d621dD8b72489FA4d7cE49), // rETH
        Asset(0x8CfB48b594D54C5BC122f3c4374E16Fcf1050a43), // fUSDC
        Asset(0x097b09fd6932cEC8cf47d5Ec0b0b7DeFb0C97b02), // fUSDT
        Asset(0x0c82eFbbd9B0f47fDa04b83226dbFBC04EC728b8), // fDAI
        Asset(0xCC0c0c376cebd701D9126228510f31F9096b836a), // fFRAX
        Asset(0x8E24283eF5F6FE85fed48AC3A3d4248B5ba29668), // cUSDCv3
        Asset(0x4aDf4c9b985A743D9fEF14ae4b3e79661F73C78b), // cUSDTv3
        Asset(0xA9f37b188d71b66C3e1ea876F61e00377174508a), // cvx3Pool
        Asset(0x7e80B2f7b6abb98028cC8A66aE6f7ea5302fA904), // cvxPayPool
        Asset(0x1E98A442F917aA8e0e1f6e18687e58D954b8FfC2), // cvxCrvUSDUSDC
        Asset(0x738C191F95C053602e272AfAF67A638519fA4B2F), // cvxCrvUSDUSDT
        Asset(0x875af0Bab943b7416c6D2142546cAb61F1Ad964a), // cvxeUSDFRAXBP
        Asset(0xfa025df685BA0A09B2C767f4Cc1a1972F140d421), // cvxETHPlusETH
        Asset(0x2fe50f96Cd61a3056D497FE88CEA8441244D5d5E), // sDAI
        Asset(0xdCEe056a2fEB893EB1a1C3e3F103Ac8AB098CE2e), // cbETH
        Asset(0x3ca3359006c55164753Ae475D995163adAB5432d), // maUSDT
        Asset(0x30789B6A26735c83774cD49e22C6f68dD4533A73), // maUSDC
        Asset(0x14CEF4f11bD1f2A9E6416b812F7D45481c9dD896), // maDAI
        Asset(0x65fF9Cf2fE6A28F5fd7fAF5Fd0E54EF9B85DF4E8), // maWBTC
        Asset(0x3Cb9DD76AEf20d97C0314ad5Cae6D3d54D87f6eE), // maWETH
        Asset(0xc8F9C28880797cF241D4241395f9Bf14c9E7135C), // maStETH
        Asset(0xFB80E9A48493ac5C3c401Aa713146825d3bB9CA6), // saEthUSDC
        Asset(0x3E2D5CF862c959F5A4046558Bec90C02dD5472eD), // saEthUSDT
        Asset(0x8B13ac47E0bF142630eAc3e838A0c0AcE8E81c35), // saEthPyUSD
        Asset(0x3B8bb1153C6b4331AC5eE50d59437A244Ed8Cf57), // yvCurveUSDCcrvUSD
        Asset(0x661335963a4e84A5e3Fb58a9110f635bbf116201), // sFRAX
        Asset(0xa514214E14d64822EE70dfF2d5E15f9a2772aD20), // sfrxETH
        Asset(0xd9Da5527B077d81b0289eae2745EaF48f0bC433f), // steakUSDC
        Asset(0x46eE78397ab4E334A85Bbc7B7C3A2935f175D4d9), // steakPYUSD
        Asset(0xC2b73b106cCb4D2Cf937bFfCD629f3e636773567), // bbUSDT
        Asset(0x2E22d688CF3846e5303f6E4eaD0a7455801813E2), // Re7WETH
        Asset(0x1c0a14A44C4a6834FE23632dA2f493cC4cf87DbA), // ETHx
        Asset(0x6F7eDae52dD7e45f470C327788249a2812A259d8), // apxETH
        Asset(0x4f30165072351923A1A4BC3926050986318f9B34), // sUSDe
        Asset(0xe0941A6e0DFC823CF44e95664a5B151041C13D42), // pyUSD
        Asset(0x8a1a3B46749b81Cf91d56dF6042E12CE50E1b08A), // sUSDS
        Asset(0xa4D38731434e875d7E30e13d8b65BEfEd7d47Ac2) // wOETH
    ];

    // 4.2.0 Assets (base)
    Asset[21] BASE_ASSETS = [
        Asset(0x22018D85BFdA9e2673FB4101e957562a1e952Cdf), // RSR
        Asset(0xf535Cab96457558eE3eeAF1402fCA6441E832f08), // COMP
        Asset(0x0e8439a17bA5cBb2D9823c03a02566B9dd5d96Ac), // STG
        Asset(0xf7d1C6eE4C0D84C6B530D53A897daa1E9eB56833), // AERO
        Asset(0xBe70970a10C186185b1bc1bE980eA09BD68fD97A), // DAI
        Asset(0xeaCaF85eA2df99e56053FD0250330C148D582547), // USDC
        Asset(0x39e19d88F3D5C25B5A684e8A500dBEC2E2c46327), // USDbC
        Asset(0x98f292e6Bb4722664fEffb81448cCFB5B7211469), // WETH
        Asset(0xA87e9DAe6E9EA5B2Be858686CC6c21B953BfE0B8), // cbETH
        Asset(0xF5366f67FF66A3CefcB18809a762D5b5931FebF8), // cUSDCv3
        Asset(0x773cf50adCF1730964D4A9b664BaEd4b9FFC2450), // saBasUSDC
        Asset(0x5ccca36CbB66a4E4033B08b4F6D7bAc96bA55cDc), // wstETH
        Asset(0x1cCa3FBB11C4b734183f997679d52DeFA74b613A), // aeroUSDCeUSD
        Asset(0xC98eaFc9F249D90e3E35E729e3679DD75A899c10), // aeroWETHAERO
        Asset(0x339c1509b980D80A0b50858518531eDbe2940dA1), // aeroMOGWETH
        Asset(0x1BD20253c49515D348dad1Af70ff2c0473FEa358), // aeroUSDzUSDC
        Asset(0xDAacEE75C863a79f07699b094DB07793D3A52D6D), // aeroWETHcbBTC
        Asset(0x6647c880Eb8F57948AF50aB45fca8FE86C154D24), // aeroWETHWELL
        Asset(0xCFA67f42A0fDe4F0Fb612ea5e66170B0465B84c1), // aeroWETHDEGEN
        Asset(0x45B950AF443281c5F67c2c7A1d9bBc325ECb8eEA), // meUSD
        Asset(0x4024c00bBD0C420E719527D88781bc1543e63dd5) // wsuperOETHb
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
    mapping(IRToken => bool) public cast;

    bool public mainnet; // !mainnet | base

    // =======================================================================================

    constructor(bool _mainnet) {
        // we have to pass-in `_mainnet` because chainid is not reliable during testing
        require(
            block.chainid == 1 || block.chainid == 31337 || block.chainid == 8453,
            "unsupported chain"
        );
        mainnet = _mainnet;

        if (_mainnet) {
            // 4.2.0 deployer (mainnet)
            deployer = IDeployer(0xd01D00c99A750329412909c02CD9C9e45ffe34ee);

            // DAO registries (mainnet)
            registries = IDeployer.Registries(
                VersionRegistry(0x37c8646139Cf69863cA8C6F09BE09300d4Dc10bf),
                AssetPluginRegistry(0x6cf05Ea2A94a101CE6A44Ec2a2995b43F1b0958f),
                DAOFeeRegistry(0xec716deD4eABa060937D1a915F166E237039342B),
                ITrustedFillerRegistry(0x279ccF56441fC74f1aAC39E7faC165Dec5A88B3A)
            );

            // Setup `assets`
            for (uint256 i = 0; i < MAINNET_ASSETS.length; i++) {
                require(
                    keccak256(abi.encodePacked(MAINNET_ASSETS[i].version())) == NEW_VERSION_HASH,
                    "invalid asset"
                );

                IERC20 erc20 = MAINNET_ASSETS[i].erc20();
                require(address(assets[erc20]) == address(0), "duplicate asset");
                assets[erc20] = MAINNET_ASSETS[i];
            }
        } else {
            // 4.2.0 deployer (base)
            deployer = IDeployer(0x1142Ad5E5A082077A7d79d211726c1bd39b0D5FA);

            // DAO registries (base)
            registries = IDeployer.Registries(
                VersionRegistry(0x35E6756B92daf6aE2CF2156d479e8a806898971B),
                AssetPluginRegistry(0x87A959e0377C68A50b08a91ae5ab3aFA7F41ACA4),
                DAOFeeRegistry(0x3513D2c7D2F51c678889CeC083E7D7Ae27b219aD),
                ITrustedFillerRegistry(0x72DB5f49D0599C314E2f2FEDf6Fe33E1bA6C7A18)
            );

            // Setup `assets`
            for (uint256 i = 0; i < BASE_ASSETS.length; i++) {
                require(
                    keccak256(abi.encodePacked(BASE_ASSETS[i].version())) == NEW_VERSION_HASH,
                    "invalid asset"
                );

                IERC20 erc20 = BASE_ASSETS[i].erc20();
                require(address(assets[erc20]) == address(0), "duplicate asset");
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
        require(keccak256(abi.encodePacked(rToken.version())) == PRIOR_VERSION_HASH, "US: 1");

        // Can only be cast once per RToken
        require(!cast[rToken], "repeat cast");
        cast[rToken] = true;

        MainP1 main = MainP1(address(rToken.main()));
        require(main.hasRole(MAIN_OWNER_ROLE, msg.sender), "US: 2"); // security crux
        require(main.hasRole(MAIN_OWNER_ROLE, address(this)), "US: 3");

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
            require(keccak256(abi.encodePacked(main.version())) == NEW_VERSION_HASH, "US: 4");

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
            require(keccak256(abi.encodePacked(rToken.version())) == NEW_VERSION_HASH, "US: 5");

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
                "US: 6"
            );

            // Revoke OWNER from Main
            main.revokeRole(MAIN_OWNER_ROLE, address(main));
            require(!main.hasRole(MAIN_OWNER_ROLE, address(main)), "US: 7");

            // Turn on trusted fills
            TestIBroker(address(proxy.broker)).setTrustedFillerRegistry(
                address(registries.trustedFillerRegistry),
                true
            );

            // Keep issuance premium off, should be off by default
            require(
                !TestIBasketHandler(address(proxy.basketHandler)).enableIssuancePremium(),
                "US: 8"
            );

            // Verify trading plugins are updated
            require(
                address(TestIBroker(address(proxy.broker)).dutchTradeImplementation()) ==
                    address(impls.trading.dutchTrade) &&
                    address(TestIBroker(address(proxy.broker)).batchTradeImplementation()) ==
                    address(impls.trading.gnosisTrade),
                "US: 9"
            );
        }

        // Make distributor table sum to 10000, adding 1 to StRSR destination if necessary
        // Context: frontend rounded down during early deployments and tables sum to 9,999 sometimes
        {
            RevenueTotals memory revTotals = proxy.distributor.totals();
            require(revTotals.rTokenTotal + revTotals.rsrTotal >= MAX_DISTRIBUTION - 1, "US: 10");

            // add 1 to StRSR destination if necessary
            if (revTotals.rTokenTotal + revTotals.rsrTotal < MAX_DISTRIBUTION) {
                TestIDistributor distributor = TestIDistributor(address(proxy.distributor));

                (uint16 rTokenDist, uint16 rsrDist) = distributor.distribution(address(2));
                // address(2) is the special-cased key for StRSR

                assert(rsrDist > 0); // sanity check; all RTokens direct _some_ RSR to StRSR

                distributor.setDistribution(address(2), RevenueShare(rTokenDist, rsrDist + 1));

                revTotals = proxy.distributor.totals();
            }

            // Distributor invariant: table must sum to >=10000
            require(revTotals.rTokenTotal + revTotals.rsrTotal >= MAX_DISTRIBUTION, "US: 11");
        }

        // Rotate assets, erc20s should not change
        {
            IERC20[] memory erc20s = proxy.assetRegistry.erc20s();

            for (uint256 i = 0; i < erc20s.length; i++) {
                IERC20 erc20 = erc20s[i];

                if (assets[erc20] != Asset(address(0))) {
                    // if we have a new asset with that erc20, swapRegistered()
                    proxy.assetRegistry.swapRegistered(assets[erc20]);
                } else {
                    // the only asset that should not be in the registry is the RToken itself
                    require(address(erc20) == address(rToken), "US: 12");
                }
            }

            // Rotate RTokenAsset
            require(
                proxy.assetRegistry.registerRTokenAsset(
                    proxy.assetRegistry.toAsset(IERC20(address(rToken))).maxTradeVolume()
                ),
                "US: 13"
            );

            // Refresh basket
            proxy.basketHandler.refreshBasket();
            require(proxy.basketHandler.status() == CollateralStatus.SOUND, "basket not sound");
        }

        // Deploy new governance, preserving all values
        {
            uint256 minDelay = TimelockController(payable(msg.sender)).getMinDelay();
            require(minDelay != 0, "US: 14");

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
            require(Governance(payable(newGovernor)).timelock() == newTimelock, "US: 15");

            TimelockController _newTimelock = TimelockController(payable(newTimelock));

            // timelock roles
            _newTimelock.grantRole(CANCELLER_ROLE, newGovernor); // Gov can cancel
            _newTimelock.grantRole(PROPOSER_ROLE, newGovernor); // Gov only proposer
            _newTimelock.grantRole(EXECUTOR_ROLE, newGovernor); // Gov only executor

            for (uint256 i = 0; i < guardians.length; i++) {
                _newTimelock.grantRole(CANCELLER_ROLE, guardians[i]); // Guardian can cancel
            }
            _newTimelock.revokeRole(TIMELOCK_ADMIN_ROLE, address(this)); // Revoke admin role

            // post validation
            require(
                _newTimelock.hasRole(PROPOSER_ROLE, newGovernor) &&
                    _newTimelock.hasRole(EXECUTOR_ROLE, newGovernor) &&
                    _newTimelock.hasRole(CANCELLER_ROLE, newGovernor),
                "US: 16"
            );

            require(
                !_newTimelock.hasRole(PROPOSER_ROLE, address(oldGovernor)) &&
                    !_newTimelock.hasRole(EXECUTOR_ROLE, address(oldGovernor)) &&
                    !_newTimelock.hasRole(CANCELLER_ROLE, address(oldGovernor)),
                "US: 17"
            );

            require(
                !_newTimelock.hasRole(PROPOSER_ROLE, address(0)) &&
                    !_newTimelock.hasRole(EXECUTOR_ROLE, address(0)) &&
                    !_newTimelock.hasRole(CANCELLER_ROLE, address(0)),
                "US: 18"
            );

            // setup `newGovs` for rToken
            newGovs[rToken] = NewGovernance(
                IGovernor(payable(newGovernor)),
                TimelockController(payable(newTimelock))
            );
        }

        // Renounce adminships and validate final state
        {
            assert(oldGovernor.timelock() == msg.sender);

            main.grantRole(MAIN_OWNER_ROLE, newTimelock);
            main.revokeRole(MAIN_OWNER_ROLE, msg.sender);
            main.renounceRole(MAIN_OWNER_ROLE, address(this));

            require(
                main.hasRole(MAIN_OWNER_ROLE, newTimelock) &&
                    !main.hasRole(MAIN_OWNER_ROLE, msg.sender) &&
                    !main.hasRole(MAIN_OWNER_ROLE, address(this)),
                "US: 19"
            );

            require(
                !main.hasRole(MAIN_OWNER_ROLE, address(oldGovernor)) &&
                    !main.hasRole(MAIN_OWNER_ROLE, newGovernor),
                "US: 20"
            );
        }
    }
}
