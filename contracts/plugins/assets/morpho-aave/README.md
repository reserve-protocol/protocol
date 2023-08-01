Submission Documentation

Twitter: MatthewJurenka, TG: mjurenka, Discord: fronts#7618,

This submission mirrors the Compound V2 family of plugins to allow support
for all pools on Morpho AAVE. As such the collateral token, reference unit,
and target unit would change depending on the desired pool that is desired.
For example for the USDT pool, the reference unit would be USDT, the target unit
would be USD, and the collateral token would be an instance of
MorphoAAVEPositionWrapper deployed alongside the plugin.

To deploy an instance of this plugin, you must deploy an instance of
MorphoAAVEPositionWrapper and then pass it as config to the
MorphoAAVEFiatCollateral, MorphoAAVESelfReferentialCollateral, or
MorphoAAVENonFiatCollateral, depending on the specific pool token that is
desired to be supported. More specific documentation on contructor parameters
can be found in the respective solidity files of these contracts.

Morpho is a lending protocol built on top of AAVE that allows users to deposit
one token as collateral, then get a significant percentage (i.e. 80%) of that
collateral back to be repayed later. Suppliers earn APY by providing the borrowed
tokens to Morpho. Suppliers do not lose money if the borrower do not repay
Morpho, because Morpho can choose to seize the borrower's collateral and repay
the supplier. The only way for a supplier to lose money is if the value of that
collateral experiences a flash crash that happens before Morpho can sell off the
collateral. Alternatively this could occur if there is a serious issue with
Chainlink and the price feeds break, causing incorrect liquidations and other logic.
MorphoAAVEPositionWrapper is designed to maintain an exchange rate on mint and burn
similar to vault tokens and will ensure that yield of the contract's morpho pool
is proportionately distributed to token burners.

This plugin follows the established and accepted logic for cTokens for disabling
the collateral plugin if it were to default.

# Claiming rewards

Unfortunately Morpho uses a rewards scheme that requires the results
of off-chain computation to be piped into an on-chain function,
which is not possible to do with Reserve's collateral plugin interface.
https://integration.morpho.xyz/track-and-manage-position/manage-positions-on-morpho/claim-morpho-rewards
claiming rewards for this wrapper can be done by any account, and must be done on Morpho's rewards distributor contract
https://etherscan.io/address/0x3b14e5c73e0a56d607a8688098326fd4b4292135
