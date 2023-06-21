// require('dotenv').config({path: './.env'})
const express = require('express')
var cors = require('cors');
const app = express();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY_LIVE);
const { resolve } = require('path')
const bodyParser = require('body-parser')


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

var applicationInformation = {}
var memberInformation = {}

app.use(
  cors({
    allowedHeaders: ["authorization", "Content-Type"], // you can change the headers
    exposedHeaders: ["authorization"], // you can change the headers
    origin: "*",
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    preflightContinue: false
  })
);
app.options('*', cors());  // enable pre-flight
app.use(bodyParser.json())


app.get('/', (req, res) => {
  res.send('Hello Express app!');
  // const path = resolve(process.env.STATIC_DIR + '/index.html')
  // res.sendFile(path)
})

app.get('/public-keys', (req, res) => {
  res.send({ key: process.env.STRIPE_PUBLIC_KEY_LIVE })
})

app.post('/myroute', (req, res) => {
  console.log('body', req.body)
  res.send(req.body)
})

app.post('/webhook', async (req, res) => {
  const event = req.body;
  const applicationReference = doc(collection(db, "applications"));
  const memberReference = doc(collection(db, "members"));
  const dinnerReference = doc(collection(db, "dinner-registrations"));

  console.log("webhook hit")

  switch (event.type) {
    case 'customer.created':
      const customer = event.data.object;
      console.log("customer created", applicationInformation)
    case 'checkout.session.completed':
      const session = event.data.object;
      console.log("checkout session id: ", session.id)
      break;
    case 'payment_intent.created':
      const paymentIntent = event.data.object;
      console.log("PaymentIntent Created: ", paymentIntent.id)
      break;
    case 'setup_intent.succeeded':
      const setupIntent = event.data.object;
      console.log("SetupIntent Created: ", setupIntent.id)
      console.log("Customer: ", setupIntent.customer)
      console.log("Payment Method", setupIntent.payment_method)
      applicationInformation.customer = setupIntent.customer
      applicationInformation.payment_method = setupIntent.payment_method
      applicationInformation.onboarded = false
      console.log("Applicant", applicationInformation)
      console.log("name", applicationInformation.name)
      if (applicationInformation.firstname != undefined) {
        await setDoc(applicationReference, applicationInformation);
        applicationInformation = {}
      }
      else if (applicationInformation.name != undefined) {
        await setDoc(dinnerReference, applicationInformation);
        applicationInformation = {}
      }
      else {
        applicationInformation.issue = "We couldn't find the applicationInformation"
        await setDoc(applicationReference, applicationInformation);
        applicationInformation = {}
      }

      break;
    case 'charge.failed':
      const chargeFailed = event.data.object;
      // console.log("charge failed", chargeFailed)
      console.log("customer", chargeFailed.customer)
      console.log("applicationInfo", applicationInformation)
      if (!applicationInformation.length == 0) {

        const q1 = query(collection(db, "applications"), where("customer", "==", chargeFailed.customer));

        const querySnapshot2 = await getDocs(q1);
        querySnapshot2.forEach((document) => {
          console.log(document.id, " => ", document.data());
          const appRef = doc(db, 'applications', document.id);
          setDoc(appRef, { chargeFailed: true }, { merge: true });
        });

      }

    case 'charge.succeeded':
      const chargeSucceeded = event.data.object;
      console.log("charge succeeded", chargeSucceeded)
      console.log("customer code", chargeSucceeded.customer)

      const q = query(collection(db, "applications"), where("customer", "==", chargeSucceeded.customer));

      const querySnapshot = await getDocs(q);
      querySnapshot.forEach((document) => {
        console.log(document.id, " => ", document.data());
        const appRef = doc(db, 'applications', document.id);
        setDoc(appRef, { approved: true }, { merge: true });
      });
    default:
      console.log('Unknown event type: ' + event.type)
  }

  res.send({ message: 'success' })

})


app.post("/prebuiltcheckout", async (req, res) => {

  console.log("prebuilt checkout hit", req.body)
  applicationInformation = req.body

  console.log(applicationInformation)

  let directUrl = ""
  let cancelUrl = ""

  if (applicationInformation.firstname != undefined && applicationInformation.clubhouse != undefined) {

    directUrl = "https://www.curve.club/application_submitted"
    cancelUrl = "https://www.curve.club/application-page"

  }

  else {

    directUrl = "https://www.curve.club/signupcomplete"
    cancelUrl = "https://www.curve.club/dinner-registration"

  }

  try {


    const customer = await stripe.customers.create();

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'setup',
      customer: customer.id,
      success_url: directUrl,
      cancel_url: cancelUrl,
    });



    res.json({ url: session.url })
    // return stripe.redirectToCheckout({ sessionId: session.id });
    // res.send({ customer, session });
  } catch (error) {
    console.log(error)
    res.status(400).send({ error });
  }
});

app.post("/monthlyCharge", async (req, res) => {

  console.log(req.body)

  const payments = req.body

  for (let i = 0; i < payments.length; i++) {
    const customerDetails = payments[i]
    const customerId = customerDetails["customerid"]
    const paymentId = customerDetails["paymentid"]
    const paymentType = customerDetails["paymentType"]
    // const membershipType = customerDetails["membershipType"]
    var paymentAmount = 22000


    // if (paymentType == "founder" && membershipType == "founding") {
    // console.log("got here")
    // paymentAmount = 22000
    // }
    // else if (paymentType == "annual") {
    //   console.log("annual user")
    // }
    console.log(customerId, paymentId, paymentAmount)

    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: paymentAmount,
        currency: 'gbp',
        customer: customerId,
        payment_method: paymentId,
        off_session: true,
        confirm: true,
      });

      res.json({ clientSecret: paymentIntent.client_secret })
    } catch (err) {
      // Error code will be authentication_required if authentication is needed
      console.log('Error code is: ', err.code);
      // res.status(400).json({ error: { message: err.message } })
      // const paymentIntentRetrieved = await  
      //stripe.paymentIntents.retrieve(err.raw.payment_intent.id);
      // console.log('PI retrieved: ', paymentIntentRetrieved.id);
    }
  }
})



app.post("/chargeUseronApproval", async (req, res) => {

  console.log(req.body)

  const payments = req.body

  for (let i = 0; i < payments.length; i++) {
    const customerDetails = payments[i]
    const customerId = customerDetails["customerid"]
    const paymentId = customerDetails["paymentid"]
    const paymentType = customerDetails["paymentType"]
    var paymentAmount = 100


    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: paymentAmount,
        currency: 'gbp',
        customer: customerId,
        payment_method: paymentId,
        off_session: true,
        confirm: true,
      });

      res.json({ clientSecret: paymentIntent.client_secret })
    } catch (err) {
      // Error code will be authentication_required if authentication is needed
      console.log('Error code is: ', err.code);
      // res.status(400).json({ error: { message: err.message } })
      // const paymentIntentRetrieved = await  
      //stripe.paymentIntents.retrieve(err.raw.payment_intent.id);
      // console.log('PI retrieved: ', paymentIntentRetrieved.id);
    }
  }
})




app.listen(process.env.PORT || 3000, () => {
  console.log('server started');
});