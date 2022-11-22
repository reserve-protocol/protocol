# Collateral plugins for gitcoin bounties

## Collateral Plugin - Coinbase - CbETH
[bounty url](https://gitcoin.co/issue/29506)

### Submission Requirements
- [no] Twitter handle (if any)
- [no] Telegram handle (if any)
- [no] Discord handle (if any)
- [] Source code for your Collateral plugin or plugins
- [] An open source license
- [here] Documentation (e.g, a README file), describing the following for each plugin:
    - [] What are the collateral token, reference unit, and target unit for this plugin?
    - [] How does one configure and deploy an instance of the plugin?
    - [] If the deployer should plug in price feeds, what units does your plugin expect those price feeds to be stated in?
    - [] Why should the value (reference units per collateral token) decrease only in exceptional circumstances?
    - [] How does the plugin guarantee that its status() becomes DISABLED in those circumstances?
    - [] Tests demonstrating the behaviors checked by our example Collateral plugin test, which we encourage you to use as a starting template for your own testing.Particular behaviors must include:
        - [] Deployment.
        - [] Issuance, appreciation, and redemption of an RToken with this Collateral in its basket.
        - [] Claiming rewards (or, if no rewards are available for this token, tests demonstrating that the claim-reward functions do nothing and don't revert)
        - [] Correct behavior for price() when any price sources return invalid values.
        - [] Correctly changing status() whenever that's needed in order to flag sudden or impending default.

### Acceptance Criteria
Each Collateral plugin must:​

- [] Fully implement the [ICollateral interface][icoll].
- [] Satisfy the correctness properties given in the Collateral plugin-writing howto.
- [] Be fully permissionless once deployed.
- [] Be documented with cogent explanations of its economics.
- [] Be deployable with USD as its Unit of Account.
- [] Not be prone to relatively simple economic attacks or cough cough “highly profitable trading strategies”​

Additionally, static analysis with slither over your whole codebase should not yield avoidable issues of moderate or greater severity. If some slither report is not sensibly avoidable, your documentation should note that, and explain either how we can see that the report is spurious, or that the problem it’s reporting is unavoidable in this circumstance.

### Plugin description

#### Plugin Units

 * Collateral token {tok} is cbETH.  
   cbETH (Coinbase Wrapped Staked ETH) is a ERC20 utility token, which is a liquid representation of coinbase customers staked-ETH.
   cbETH gives Coinbase customers the option to sell, transfer, or otherwise use their staked ETH in dapps while it remains locked.
 * Reference unit {ref} is ETH
   Convertion rate is defined within [coinbase cbETH contract](https://etherscan.io/address/0xBe9895146f7AF43049ca1c1AE358B0541Ea49704) function "exchangeRate()".
   refPerTok() satisfies: 
    - a good maket rate for {ref/tok}
    - nondecreasing over time (if not this plugin will immediately default)
 * Target unit {target} = {ref}  = ETH
   Natural unit is simply ETH.
   targetPerRef() is a 1:1 constant function
 * Unit of Account {UoA} = USD


 #### Rates

 {UoA/tok} from chainlink CBETH / USD contract 0x67eF3CAF8BeB93149F48e8d20920BEC9b4320510

 {ref/tok} from contract function 'exchangeRate()'

 

    




========

Monetary units:

colateral cbETH
reference ETH
target USD

???
col tok cbETH
ref ETH => OK 
target USD orrr ETH ??? => ETH target per ref must be constant 
UaA USD ok 

Prime basket: <collateral token, target unit, target amount> 
<cbETH, USD, 1100.99> => "The RToken should contain 1100.99 USD per basket, as represented by cbETH"

Reference basket: <collateral token, reference unit, reference amount>
<cbETH, ETH, 1> => "one basket unit should contain whatever amount of cbETH is redeemable in its protocol for 1 ETH"

Collateral basket: <collateral token, token amount>
<cbETH, 99> => "one basket unit will contain 99 cbETH"




