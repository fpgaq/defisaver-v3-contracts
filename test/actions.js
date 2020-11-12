const axios = require('axios');

const makerVersion = "1.1.3";

const { getAssetInfo } = require('defisaver-tokens');

const {
    redeploy,
    approve,
    getAddrFromRegistry,
    nullAddress,
    WETH_ADDRESS,
    UNISWAP_WRAPPER,
    balanceOf,
} = require("./utils"); 

const { getVaultsForUser } = require('./utils-mcd');

const { deployContract } = require("../scripts/utils/deployer");

const encodeMcdOpenAction = (joinAddr) => {
    const abiCoder = new ethers.utils.AbiCoder();

    const encodeActionParams = abiCoder.encode(
        ['address'],
        [joinAddr]
    );

    return encodeActionParams;
};

const encodeMcdPaybackAction = (vaultId, amount, from) => {
    const abiCoder = new ethers.utils.AbiCoder();

    const vaultIdEncoded = abiCoder.encode(['uint256'], [vaultId]);
    const amountEncoded = abiCoder.encode(['uint256'], [amount]);
    const fromEncoded = abiCoder.encode(['address'], [from]);

    return [vaultIdEncoded, amountEncoded, fromEncoded];
};

const encodeMcdSupplyAction = (vaultId, amount, joinAddr, from) => {
    const abiCoder = new ethers.utils.AbiCoder();

    const vaultIdEncoded = abiCoder.encode(['uint256'], [vaultId]);
    const amountEncoded = abiCoder.encode(['uint256'], [amount]);
    const joinAddrEncoded = abiCoder.encode(['address'], [joinAddr]);
    const fromEncoded = abiCoder.encode(['address'], [from]);

    return [vaultIdEncoded, amountEncoded, joinAddrEncoded, fromEncoded];
};

const encodeMcdWithdrawAction = (vaultId, amount, joinAddr, to) => {
    const abiCoder = new ethers.utils.AbiCoder();

    const vaultIdEncoded = abiCoder.encode(['uint256'], [vaultId]);
    const amountEncoded = abiCoder.encode(['uint256'], [amount]);
    const joinAddrEncoded = abiCoder.encode(['address'], [joinAddr]);
    const toEncoded = abiCoder.encode(['address'], [to]);

    return [vaultIdEncoded, amountEncoded, joinAddrEncoded, toEncoded];
};

const encodeMcdGenerateAction = (vaultId, amount, to) => {
    const abiCoder = new ethers.utils.AbiCoder();

    const vaultIdEncoded = abiCoder.encode(['uint256'], [vaultId]);
    const amountEncoded = abiCoder.encode(['uint256'], [amount]);
    const toEncoded = abiCoder.encode(['address'], [to]);

    return [vaultIdEncoded, amountEncoded, toEncoded];
};

const encodeDfsSellAction = async  (dfsSell, fromToken, toToken, amount, wrapperAddress, from, to) => {
    const abiCoder = new ethers.utils.AbiCoder();

    let firstPath = fromToken;
    let secondPath = toToken;

    if (fromToken.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee") {
        firstPath = WETH_ADDRESS;
    }

    if (toToken.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee") {
        secondPath = WETH_ADDRESS;
    }

    const path = abiCoder.encode(['address[]'],[[firstPath, secondPath]]);

    const exchangeData = await dfsSell.packExchangeData([
        fromToken, toToken, amount.toString(), 0, 0, 0, nullAddress, wrapperAddress, path,
        [nullAddress, nullAddress, 0, 0, ethers.utils.toUtf8Bytes('')]
    ]);

    const fromEncoded = abiCoder.encode(['address'], [from]);
    const toEncoded = abiCoder.encode(['address'], [from]);

    return [exchangeData, fromEncoded, toEncoded];
};

const sell = async (proxy, sellToken, buyToken, sellAmount, from, to) => {
    const dfsSellAddr = await getAddrFromRegistry('DFSSell');

    if (dfsSellAddr === nullAddress) {
        await redeploy('DFSSell');
    }

    const dfsSell = await hre.ethers.getContractAt("DFSSell", dfsSellAddr);

    const sellAddr = getAssetInfo(sellToken).address;
    const buyAddr = getAssetInfo(buyToken).address;

    const amount = sellAmount * 10**getAssetInfo(sellToken).decimals;
    let value = '0';

    if (sellToken.toLowerCase() === 'eth') {
        value = amount.toString();
    } else {
        await approve(sellAddr, proxy.address);
    }

    if (sellAddr === nullAddress || buyAddr === nullAddress) {
        console.log("Can't find tokens address");
    }

    const callData = await encodeDfsSellAction(
        dfsSell, sellAddr, buyAddr, amount, UNISWAP_WRAPPER, from, to);

    const DfsSell = await ethers.getContractFactory("DFSSell");
    const functionData = DfsSell.interface.encodeFunctionData(
        "executeAction",
         [callData, [], [0, 0, 0, 0, 0], []]
    );

    await proxy['execute(address,bytes)'](dfsSellAddr, functionData, {value, gasLimit: 2000000});

};

const openMcd = async (proxy, makerAddresses, joinAddr) => {
    const mcdOpenAddr = await getAddrFromRegistry('McdOpen');

    if (mcdOpenAddr === nullAddress) {
        await redeploy('McdOpen');
    }

    const callData = encodeMcdOpenAction(joinAddr);

    const McdOpen = await ethers.getContractFactory("McdOpen");
    const functionData = McdOpen.interface.encodeFunctionData(
        "executeAction",
            [[callData], [], [0], []]
    );

    await proxy['execute(address,bytes)'](mcdOpenAddr, functionData, {gasLimit: 1000000});

    const vaultsAfter = await getVaultsForUser(proxy.address, makerAddresses);

    return vaultsAfter.ids[vaultsAfter.ids.length - 1].toString();
};

const supplyMcd = async (proxy, symbol, tokenAddr, vaultId, amount, joinAddr, from) => {
    const tokenBalance = await balanceOf(tokenAddr, from);

    if (tokenBalance.lt(amount)) {
        await sell(
            proxy,
            'ETH',
            symbol,
            '2',
            from,
            from
        );
    }

    let mcdSupplyAddr = await getAddrFromRegistry('McdSupply');

    if (mcdSupplyAddr === nullAddress) {
        await redeploy('McdSupply');
    }

    mcdSupplyAddr = await getAddrFromRegistry('McdSupply');

    const callData = encodeMcdSupplyAction(vaultId, amount, joinAddr, from);

    let value = '0';

    if (symbol.toLowerCase() === 'eth') {
        value = amount.toString();
    } else {
        await approve(tokenAddr, proxy.address);
    }

    const McdSupply = await ethers.getContractFactory("McdSupply");
    const functionData = McdSupply.interface.encodeFunctionData(
        "executeAction",
            [callData, [], [0, 0, 0, 0], []]
    );

    await proxy['execute(address,bytes)'](mcdSupplyAddr, functionData, {value, gasLimit: 2000000});
};

const generateMcd = async (proxy, vaultId, amount, to) => {
    const mcdGenerateAddr = await getAddrFromRegistry('McdGenerate');

    const callData = encodeMcdGenerateAction(vaultId, amount, to);

    const McdGenerate = await ethers.getContractFactory("McdGenerate");
    const functionData = McdGenerate.interface.encodeFunctionData(
        "executeAction",
            [callData, [], [0, 0, 0], []]
    );

    await proxy['execute(address,bytes)'](mcdGenerateAddr, functionData, { gasLimit: 2000000});
};

const paybackMcd = async (proxy, vaultId, amount, from) => {
    const mcdPaybackAddr = await getAddrFromRegistry('McdPayback');

    const callData = encodeMcdPaybackAction(vaultId, amount, from);

    const McdPayback = await ethers.getContractFactory("McdPayback");
    const functionData = McdPayback.interface.encodeFunctionData(
        "executeAction",
            [callData, [], [0, 0, 0], []]
    );

    await proxy['execute(address,bytes)'](mcdPaybackAddr, functionData, { gasLimit: 2000000});
};

const withdrawMcd = async (proxy, vaultId, amount, joinAddr, to) => {
    const mcdWithdrawAddr = await getAddrFromRegistry('McdWithdraw');

    const callData = encodeMcdWithdrawAction(vaultId, amount, joinAddr, to);

    const McdWithdraw = await ethers.getContractFactory("McdWithdraw");
    const functionData = McdWithdraw.interface.encodeFunctionData(
        "executeAction",
            [callData, [], [0, 0, 0, 0], []]
    );

    await proxy['execute(address,bytes)'](mcdWithdrawAddr, functionData, { gasLimit: 2000000});
};

const openVault = async (makerAddresses, proxy, joinAddr, tokenData, collAmount, daiAmount) => {
    const vaultId = await openMcd(proxy, makerAddresses, joinAddr);
    const amountColl = ethers.utils.parseUnits(collAmount, tokenData.decimals);

    const from = proxy.signer.address;
    const to = proxy.signer.address;

    const amountDai = ethers.utils.parseUnits(daiAmount, 18);

    await supplyMcd(proxy, tokenData.symbol, tokenData.address, vaultId, amountColl, joinAddr, from);
    await generateMcd(proxy, vaultId, amountDai, to);

    return vaultId;
};

module.exports = {
    sell,
    openMcd,
    supplyMcd,
    generateMcd,
    paybackMcd,
    withdrawMcd,
    openVault,
    encodeDfsSellAction,
    encodeMcdSupplyAction,
    encodeMcdWithdrawAction,
    encodeMcdOpenAction,
    encodeMcdGenerateAction,
    encodeMcdPaybackAction,
};