import Binance, {
    AvgPriceResult,
    ErrorCodes,
    DailyStatsResult,
    ExecutionReport,
    Message,
    NewOrder,
    Order,
    SymbolLotSizeFilter,
    SymbolMinNotionalFilter,
    SymbolPercentPriceFilter,
    SymbolPriceFilter,
    Trade
} from "binance-api-node";

require("dotenv").config();

const axios = require('axios');
const crypto = require('crypto-js');
const tulind = require('tulind');

const fs = require('fs');  // to access filesystem
const moment = require('moment'); // for date formatting

const exchange = 'BIN';  // Supported exchange: BIN
const pair = 'DOGEUSDT';
const interval = '1m';  // Supported Intervals: 1m,3m,5m,15m,30m,1h,2h,4h,6h,8h,12h,1d,3d,1w,1M
const sellpercent = 1.10; // When price goes up by this much, sell.
const buypercent = 1.05; // When price goes down by this much, buy.
const initialFunds = 10000; // Starting balance

var funds = initialFunds; // used in profit calculation
var coins = 0; // holds purchased coins
let historicalData:string[][] = [[]]; // object to hold the json file data
var openedPositions = 0; // holds number of trading positions open
var totalProfit = 0; // holds profit made

let simulatedOrders:any[] = []

const binance = Binance({
    apiKey: process.env.APIKEY || "",
    apiSecret: process.env.APISECRET || ""
});

var request = require('request-promise');

const exitHooks = async (cancel: Function): Promise<void> => {
    // TODO: Finish implementing
    // safety mechanism - cancel order if process is interrupted.
    process.once(
        "SIGINT",
        async (code): Promise<void> => {
        console.debug(`handled script interrupt - code ${code}.`);
        await cancel();
    }
);

    process.once(
        "SIGTERM",
        async (code): Promise<void> => {
        console.debug(`handled script interrupt - code ${code}.`);
        await cancel();
    }
);
};

const run = (simulated: boolean) => {
    let period = 3
    let interval = "5m"
    let highs: number[] = []
    let lows: number[] = []
    let closes: number[] = []
    let volumes: number[] = []
    let mfi = 0
    let startDate = Date.now()

    binance.ws.candles(pair, interval, candle => {
        if(candle.isFinal) {
            let open = parseFloat(candle.open)
            let high = parseFloat(candle.high)
            let low = parseFloat(candle.low)
            let close = parseFloat(candle.close)
            let volume = parseFloat(candle.volume)

            console.info(`[candleStick] ${pair} open: ${open} close: ${close} high: ${high} low: ${low} volume: ${volume}`);

            highs.push(high)
            lows.push(low)
            closes.push(close)
            volumes.push(volume)

            // If last candlestick had a MFI > 100 and this candle is bullish (close > open) then buy
            if(buySignal(mfi, close, open)) {
                buy(simulated, 1000, close)
            }

            if(simulated) {
                simulatedOrders.forEach((value, index, array) => {
                    if(!value.sold) {
                        binance.dailyStats({ symbol: pair }).then((stats: any) => {
                            if(sellSignal(value.buyDate, value.buyPrice, close, stats.lowPrice)) {
                                value.sellPrice = parseFloat(candle.close)
                                value.sellDate = Date.now()
                                funds = value.sellPrice * coins;
                                var profit = funds - initialFunds;
                                console.log(moment(value.sellDate).format('LLL') + ', ' + pair + ', ' + 'SELL' + ', ' + coins.toFixed(2) + ' @ ' + value.sellPrice.toFixed(2) + ', ' + 'profit=' +profit.toFixed(2) + ', ' + 'balance=' + funds.toFixed(2));
                                coins = 0;
                                totalProfit = profit;
                                profit = 0;
                                value.sold = true
                            }
                        })
                    }
                })
            }

            tulind.indicators.mfi.indicator([highs, lows, closes, volumes], [period], (err: any, res: any) => {
                if (err) console.error(err)
                mfi = res[0][res[0].length-1] ?? 0
            })

            console.info(`[mfi] mfi: ${mfi}`);
            console.info(`[status] start: ${moment(Date.now()).format('LLL')} positions opened: ${openedPositions} profit: ${totalProfit.toFixed(2)} balance: ${funds}`)
        }
    });
}

const sellSignal = (buyDate: any, buyPrice: number, close: number, lowPrice: number) => {
    let today = Date.now();
    var diffMs = (today - buyDate);
    let oneHourPassed = Math.floor((diffMs % 86400000) / 3600000) >= 1;
    let targetPriceMet = close >= buyPrice * 1.10;
    let stopPriceMet = close <= lowPrice
    let sell = oneHourPassed || targetPriceMet || stopPriceMet
    console.info(`[sellSignal] sell: ${sell} oneHourPassed: ${oneHourPassed} targetPriceMet: ${targetPriceMet} stopPriceMet: ${stopPriceMet}`)
    return sell
}

const buySignal = (mfi: number, close: number, open: number) => {
    let buy = mfi >= 100 && close > open
    console.info(`[buySignal] buy: ${buy} mfi: ${mfi} close: ${close} open: ${open}`)
    return buy
}

const buy = async(simulated: boolean, quantity: number, price: number) => {
    if(simulated) {
        simulatedBuy(quantity, price)
    } else {
        realBuy(quantity)
    }
}

const realBuy = async(quantity: number) => {
    let dailyStats: any = await binance.dailyStats({ symbol: pair })

    // TODO: Before we buy check our account balance and make sure we have enough $$$

    console.info(`Buying ${quantity} [${pair}]`)

    // TODO: Calculate # of shares based on fixed dollar amount. Use 1/10 of reserves in account.
    
    const buyOrder = await binance.order({
            symbol: pair,
            side: 'BUY',
            quantity: '1',
            type: "MARKET"
        });

    console.info(`[${buyOrder.orderId}] Buying ${quantity} ${pair} at ${buyOrder.price}`)

    // Should go for 10-20 pips
    const pips = .10
    const targetPrice = (parseFloat(buyOrder.price) * (1 + pips))

    // Stop loss should be at below the low of the day
    const stopPrice = dailyStats.lowPrice

    const ocoSellOrder = await binance.orderOco({
        symbol: pair,
        side: "SELL",
        quantity: quantity.toString(),
        price: targetPrice.toString(),
        stopPrice: stopPrice.toString(),
        stopLimitPrice: stopPrice.toString()
    });

    console.info(`[${ocoSellOrder.orders[0].orderId}] Selling ${quantity} ${pair} ${ocoSellOrder.orderReports[0].type} ${ocoSellOrder.orderReports[0].price} ${ocoSellOrder.orderReports[0].stopPrice}`);

    setTimeout(() => {
        console.info("Selling after 60 minutes.")
        // TODO: Check if order has already sold. If not then sell:
        const sellOrder = binance.order({
            symbol: pair,
            side: 'BUY',
            quantity: '1',
            type: "MARKET"
        });
    }, 60*60*1000)
}

const simulatedBuy = async(quantity: number, price: number) => {
    if(funds < (quantity*price)) {
        console.error("[simulatedBuy] Not enough funds to buy!")
        return
    }
    var buyDate = new Date();
    openedPositions ++ ;
    funds = funds - (price * quantity);
    simulatedOrders.push({buyPrice: price, quantity: quantity, sellPrice: 0, sold: false, buyDate: buyDate})
    console.log(moment(buyDate).format('LLL') + ', ' + pair + ', ' + 'BUY ' + ', ' + quantity + ' @ ' + price + ', ' + 'balance=' + funds);
}

run(true)