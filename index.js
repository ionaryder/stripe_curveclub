// require('dotenv').config({path: './.env'})
const express = require('express')
const app = express();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); 
const {resolve} = require('path')
const bodyParser = require('body-parser')
var cors = require('cors');

//FIREBASE
const { initializeApp } = require("firebase/app");
const { doc, setDoc, getFirestore, collection, query, where, getDocs, updateDoc } = require("firebase/firestore"); 
const { Console } = require('console');
require('firebase/compat/auth');
require('firebase/compat/firestore');

const firebaseConfig = {
    apiKey: "AIzaSyDrkrg6O5A2V_1uk9fMiUDJOascZcfvUBk",
    authDomain: "curveclub-68421.firebaseapp.com",
    projectId: "curveclub-68421",
    storageBucket: "curveclub-68421.appspot.com",
    messagingSenderId: "985129645569",
    appId: "1:985129645569:web:40d5198dbeda9618257200",
    measurementId: "G-PPGZ61Q7KS"
  };
  // Initialize Firebase
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(app);

app.use(cors({origin: '*'}));
// app.use(express.static(process.env.STATIC_DIR))
app.use(bodyParser.json())

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});

app.get('/', (req, res) => {
  res.send('Hello Express app!');
    // const path = resolve(process.env.STATIC_DIR + '/index.html')
    // res.sendFile(path)
})

app.get('/public-keys', (req,res) => {
    res.send({ key: process.env.STRIPE_PUBLIC_KEY})
})

app.post('/myroute', (req,res) => {
    console.log('body', req.body)
    res.send(req.body)
})

app.post('/webhook', cors(), (req,res) => {
    const event = req.body;

    console.log(req.body)

    switch(event.type) {
        case 'checkout.session.completed':
            const session = event.data.object;
            console.log("checkout session id: ",session.id)
            break;
        case 'payment_intent.created':
            const paymentIntent = event.data.object;
            console.log("PaymentIntent Created: ",paymentIntent.id)
            break;      
        case 'setup_intent.succeeded':
            const setupIntent = event.data.object;
            console.log("SetupIntent Created: ", setupIntent.id)
            console.log("Customer: ", setupIntent.customer)
            console.log("Payment Method", setupIntent.payment_method)
            break;    
        default:
            console.log('Unknown event type: ' + event.type)
    }
 
    res.send({ message: 'success'})

})


app.post("/prebuiltcheckout", cors(), async (req, res) => {

    console.log("prebuilt checkout hit")
  
    try {
        

    const customer = await stripe.customers.create();
    const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'setup',
        customer: customer.id,
        success_url: 'http://localhost:4242/success?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: 'http://localhost:4242/cancel',
    });

    console.log("session", session)

    console.log("response", res)
    res.redirect(303, session.url);
    // return stripe.redirectToCheckout({ sessionId: session.id });
    //   res.send({ customer, session });
    } catch (error) {
      res.status(400).send({ error });
    }
  });


app.post("/chargeUser", async (req, res) => {
    try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: 200,
          currency: 'gbp',
          customer: 'cus_MRZPGQixbQEPuu',
          payment_method: 'pm_1LigHUDQ1Xr1pzwr11np7fNj',
          off_session: true,
          confirm: true,

        });

        res.json({clientSecret: paymentIntent.client_secret})
      } catch (err) {
        // Error code will be authentication_required if authentication is needed
        console.log('Error code is: ', err.code);
        res.status(400).json({ error: { message: err.message}})
        // const paymentIntentRetrieved = await stripe.paymentIntents.retrieve(err.raw.payment_intent.id);
        // console.log('PI retrieved: ', paymentIntentRetrieved.id);
      }

      
})




app.listen(process.env.PORT || 3000, () => {
  console.log('server started');
});