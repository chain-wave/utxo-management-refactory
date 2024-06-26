import {
  Transaction,
  script,
  Psbt,
  initEccLib,
  networks,
  Signer as BTCSigner,
  crypto,
  payments,
  opcodes,
  address as Address
} from "bitcoinjs-lib";

import { Taptree } from "bitcoinjs-lib/src/types";
import { ECPairFactory, ECPairAPI } from "ecpair";
import ecc from "@bitcoinerlab/secp256k1";
import axios, { AxiosResponse } from "axios";
import networkConfig from "config/network.config";
import { WIFWallet } from 'utils/WIFWallet'
import { SeedWallet } from "utils/SeedWallet";
import cbor from 'cbor'
//test
const network = networks.testnet;
// const network = networks.bitcoin;

initEccLib(ecc as any);
const ECPair: ECPairAPI = ECPairFactory(ecc);

// const seed: string = process.env.MNEMONIC as string;
// const networkType: string = networkConfig.networkType;
// const wallet = new SeedWallet({ networkType: networkType, seed: seed });

const privateKey: string = process.env.PRIVATE_KEY as string;
const networkType: string = networkConfig.networkType;
const wallet = new WIFWallet({ networkType: networkType, privateKey: privateKey });

const receiveAddress: string = "tb1ppx220ln489s5wqu8mqgezm7twwpj0avcvle3vclpdkpqvdg3mwqsvydajn";
const metadata = {
  'type': 'Bitmap',
  'description': 'Bitmap Community Parent Ordinal'
}
const metadataBuffer = cbor.encode(metadata);

export function createparentInscriptionTapScript(): Array<Buffer> {

  const keyPair = wallet.ecPair;
  const parentOrdinalStacks: any = [
    toXOnly(keyPair.publicKey),
    opcodes.OP_CHECKSIG,
    opcodes.OP_FALSE,
    opcodes.OP_IF,
    Buffer.from("ord", "utf8"),
    1,
    1,
    Buffer.concat([Buffer.from("text/plain;charset=utf-8", "utf8")]),
    1,
    5,
    metadataBuffer,
    opcodes.OP_0,
    Buffer.concat([Buffer.from("reinscription.bitmap", "utf8")]),
    opcodes.OP_ENDIF,
  ];
  return parentOrdinalStacks;
}

async function reInscribe() {
  const keyPair = wallet.ecPair;
  const parentOrdinalStack = createparentInscriptionTapScript();

  const ordinal_script = script.compile(parentOrdinalStack);

  const scriptTree: Taptree = {
    output: ordinal_script,
  };

  const redeem = {
    output: ordinal_script,
    redeemVersion: 192,
  };

  const ordinal_p2tr = payments.p2tr({
    internalPubkey: toXOnly(keyPair.publicKey),
    network,
    scriptTree,
    redeem,
  });

  const address = ordinal_p2tr.address ?? "";
  console.log("Sending coin to address", address);

  const SendOrdinalsPsbt = new Psbt({ network });
  
  const sendOrdinalPsbtFee = 30000;

  const SendUtxos: Array<any> = [
    {
      txid: '7402984dae838f6700b561f425aacac82b91bc5924fb853631af65f0431cc76a',
      vout: 0,
      value: 546
    },
    {
      txid: 'ea4303aaa2c7939931a2ba129c9fc915d1905d441f2a74b6cd694c71665c7682',
      vout: 2,
      value: 129454
    }  
  ]
  
  SendOrdinalsPsbt.addInput({
    hash: SendUtxos[0].txid,
    index: SendUtxos[0].vout,
    witnessUtxo: {
      value: SendUtxos[0].value,
      script: wallet.output,
    },
    tapInternalKey: toXOnly(keyPair.publicKey),
  });
  
  SendOrdinalsPsbt.addInput({
    hash: SendUtxos[1].txid,
    index: SendUtxos[1].vout,
    witnessUtxo: {
      value: SendUtxos[1].value,
      script: wallet.output,
    },
    tapInternalKey: toXOnly(keyPair.publicKey),
  });

  SendOrdinalsPsbt.addOutput({
    address: address, //Destination Address
    value: 70000,
  });

  const SendOrdinalUtxoChange = SendUtxos[0].value + SendUtxos[1].value - 70000 - sendOrdinalPsbtFee;

  SendOrdinalsPsbt.addOutput({
    address: receiveAddress, //Destination Address
    value: SendOrdinalUtxoChange,
  });

  await SendUtxoSignAndSend(keyPair, SendOrdinalsPsbt);
  
  const utxos = await waitUntilUTXO(address as string);
  const psbt = new Psbt({ network });

  const transaction_fee = 30000;

  psbt.addInput({
    hash: utxos[0].txid,
    index: utxos[0].vout,
    tapInternalKey: toXOnly(keyPair.publicKey),
    witnessUtxo: { value: utxos[0].value, script: ordinal_p2tr.output! },
    tapLeafScript: [
      {
        leafVersion: redeem.redeemVersion,
        script: redeem.output,
        controlBlock: ordinal_p2tr.witness![ordinal_p2tr.witness!.length - 1],
      },
    ],
  });
  const change = utxos[0].value - 546 - transaction_fee;

  psbt.addOutput({
    address: receiveAddress, //Destination Address
    value: 546,
  });

  psbt.addOutput({
    address: receiveAddress, // Change address
    value: change,
  });

  await signAndSend(keyPair, psbt);
}

reInscribe()

export async function signAndSend(
  keypair: BTCSigner,
  psbt: Psbt,
) {
  psbt.signInput(0, keypair);
  psbt.finalizeAllInputs()
  const tx = psbt.extractTransaction();

  console.log(tx.virtualSize())
  console.log(tx.toHex())

  // const txid = await broadcast(tx.toHex());
  // console.log(`Success! Txid is ${txid}`);
}


export async function SendUtxoSignAndSend(
  keypair: BTCSigner,
  psbt: Psbt,
) {
  const signer = tweakSigner(keypair, { network })
  psbt.signInput(0, signer);
  psbt.signInput(1, signer);
  psbt.finalizeAllInputs()
  const tx = psbt.extractTransaction();

  console.log(tx.virtualSize())
}

export async function waitUntilUTXO(address: string) {
  return new Promise<IUTXO[]>((resolve, reject) => {
    let intervalId: any;
    const checkForUtxo = async () => {
      try {
        const response: AxiosResponse<string> = await blockstream.get(
          `/address/${address}/utxo`
        );
        const data: IUTXO[] = response.data
          ? JSON.parse(response.data)
          : undefined;
        console.log(data);
        if (data.length > 0) {
          resolve(data);
          clearInterval(intervalId);
        }
      } catch (error) {
        reject(error);
        clearInterval(intervalId);
      }
    };
    intervalId = setInterval(checkForUtxo, 4000);
  });
}
export async function getTx(id: string): Promise<string> {
  const response: AxiosResponse<string> = await blockstream.get(
    `/tx/${id}/hex`
  );
  return response.data;
}
const blockstream = new axios.Axios({
  baseURL: `https://mempool.space/testnet/api`,
  // baseURL: `https://mempool.space/api`,
});
export async function broadcast(txHex: string) {
  const response: AxiosResponse<string> = await blockstream.post("/tx", txHex);
  return response.data;
}
function tapTweakHash(pubKey: Buffer, h: Buffer | undefined): Buffer {
  return crypto.taggedHash(
    "TapTweak",
    Buffer.concat(h ? [pubKey, h] : [pubKey])
  );
}
function toXOnly(pubkey: Buffer): Buffer {
  return pubkey.subarray(1, 33);
}
function tweakSigner(signer: any, opts: any = {}) {
  let privateKey = signer.privateKey;
  if (!privateKey) {
    throw new Error('Private key is required for tweaking signer!');
  }
  if (signer.publicKey[0] === 3) {
    privateKey = ecc.privateNegate(privateKey);
  }
  const tweakedPrivateKey = ecc.privateAdd(privateKey, tapTweakHash(toXOnly(signer.publicKey), opts.tweakHash));
  if (!tweakedPrivateKey) {
    throw new Error('Invalid tweaked private key!');
  }
  return ECPair.fromPrivateKey(Buffer.from(tweakedPrivateKey), {
    network: opts.network,
  });
}
interface IUTXO {
  txid: string;
  vout: number;
  status: {
    confirmed: boolean;
    block_height: number;
    block_hash: string;
    block_time: number;
  };
  value: number;
}