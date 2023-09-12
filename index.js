// require('dotenv').config({path: './.env'})
const express = require('express')
var cors = require('cors');
const app = express();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY_LIVE);
const { resolve } = require('path')
const bodyParser = require('body-parser')


//FIREBASE
const { initializeApp } = require("firebase/app");
const { doc, setDoc, getFirestore, collection, query, where, getDocs, updateDoc, serverTimestamp, addDoc } = require("firebase/firestore");
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

      applicationInformation.freeMembership = false
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
      console.log("customer paid", chargeSucceeded.paid)

      const q = query(collection(db, "applications"), where("customer", "==", chargeSucceeded.customer));

      if (chargeSucceeded.paid == true) {
        const querySnapshot = await getDocs(q);
        querySnapshot.forEach((document) => {
          console.log(document.id, " => ", document.data());
          const appRef = doc(db, 'applications', document.id);
          setDoc(appRef, { approved: true, active: true }, { merge: true });
        });
      }

    case 'invoice.finalized':
      const invoice = event.data.object;
      console.log("customer", invoice.customer)
      //Find the customer in the members table, get their memberID and create an object to be appended to the members_activity table. 

      break
    case 'invoice.payment_failed':
      const failed_invoice = event.data.object;
      console.log("failing customer", failed_invoice.customer)
      getDefaultingCustomer(failed_invoice)
      break

    case 'invoice.updated':
      const invoice_updated = event.data.object;
      console.log("invoice_updated", invoice_updated)
      if (invoice_updated.amount_paid == 0) {
        console.log("getting defaulting customer")
        getDefaultingCustomer(invoice_updated)
          .then((memberId) => {
            console.log("worked", memberId)
          })
          .catch((error) => {
            console.log("catch", error)
          });
      }
      else if (invoice_updated.amount_due == 0) {
        getActiveCustomer(invoice_updated)
          .then((memberId) => {
            console.log("worked", memberId)
          })
          .catch((error) => {
            console.log("catch", error)
          });
      }
      else {
        console.log("else reached", invoice_updated)
      }
      break
    default:
      console.log('Unknown event type: ' + event.type)
  }

  res.send({ message: 'success' })

})

async function getDefaultingCustomer(invoice) {
  const customer = invoice.customer;

  try {
    // Reference to your Firestore collection
    const membersCollection = collection(db, 'members');

    // Create a Firestore query to find the member with a matching customer value
    const q = query(membersCollection, where('customer', '==', customer));

    // Execute the query and get the results
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      console.log('No matching document found');
      return null; // Handle the case where no matching document is found
    }

    // Assuming there's only one matching document (if multiple, you can loop through querySnapshot.docs)
    const matchingDoc = querySnapshot.docs[0];

    // Retrieve the memberId from the matching document
    const memberId = matchingDoc.id;

    console.log('Found matching document with memberId:', memberId);

    // Create a new document in the "members_activity" collection with the desired structure
    const newDocumentData = {
      status: 'defaulting',
      memberId: matchingDoc.data().memberId,
      membership_type: matchingDoc.data().membership,
      updatedAt: serverTimestamp() // Current timestamp
    };

    // Reference to the Firestore collection "members_activity" where you want to create the new document
    const activityCollection = collection(db, 'membership_activity');

    // Add the new document to the "members_activity" collection
    await addDoc(activityCollection, newDocumentData);

    console.log('New document created in members_activity collection');

    return memberId;
  } catch (error) {
    console.error('Error retrieving or creating document in Firestore:', error);
    // Handle the error as needed
    throw error;
  }
}

async function getActiveCustomer(invoice) {
  const customer = invoice.customer;

  try {
    // Reference to your Firestore collection
    const membersCollection = collection(db, 'members');

    // Create a Firestore query to find the member with a matching customer value
    const q = query(membersCollection, where('customer', '==', customer));

    // Execute the query and get the results
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      console.log('No matching document found');
      return null; // Handle the case where no matching document is found
    }

    // Assuming there's only one matching document (if multiple, you can loop through querySnapshot.docs)
    const matchingDoc = querySnapshot.docs[0];

    // Retrieve the memberId from the matching document
    const memberId = matchingDoc.id;

    console.log('Found matching document with memberId:', memberId);

    // Create a new document in the "members_activity" collection with the desired structure
    const newDocumentData = {
      status: 'active',
      memberId: matchingDoc.data().memberId,
      membership_type: matchingDoc.data().membership,
      updatedAt: serverTimestamp() // Current timestamp
    };

    // Reference to the Firestore collection "members_activity" where you want to create the new document
    const activityCollection = collection(db, 'membership_activity');

    // Add the new document to the "members_activity" collection
    await addDoc(activityCollection, newDocumentData);

    console.log('New document created in members_activity collection');

    return memberId;
  } catch (error) {
    console.error('Error retrieving or creating document in Firestore:', error);
    // Handle the error as needed
    throw error;
  }
}

app.post("/prebuiltcheckout", async (req, res) => {

  console.log("prebuilt checkout hit", req.body)
  applicationInformation = req.body

  console.log("app info", applicationInformation)

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
    // const customer = await stripe.customers.create(); //add email

    const customer = await stripe.customers.create({
      email: applicationInformation.email // replace with the customer's email
    });

    console.log("testing", applicationInformation.email)

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

app.post("/claimpass_checkout", async (req, res) => {
  const requestData = req.body;

  console.log("app info", requestData);

  let directUrl = "https://www.curve.club/claim-pass-confirmed";
  let cancelUrl = "https://www.curve.club/claim-pass";

  try {
    // Create a customer
    const customer = await stripe.customers.create({
      email: requestData.email // Replace with the customer's email
    });

    // Create a Payment Intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: requestData.stripe_price, // Replace with the amount in cents (e.g., 1000 for $10.00)
      currency: 'gbp', // Replace with your desired currency code
      customer: customer.id,
      payment_method_types: ['card'],
    });

    // Create a Checkout Session using the Payment Intent
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer: customer.id,
      payment_intent_data: {
        setup_future_usage: 'off_session', // This ensures that the payment can be used for future off-session payments.
      },
      success_url: directUrl,
      cancel_url: cancelUrl,
      line_items: [{
        price: requestData.product_id, // Replace with the Price ID of your product
        quantity: 1,
      }],
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error(error);
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
    var paymentAmount = customerDetails["paymentAmount"]


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

app.post("/event_payment", async (req, res) => {

  console.log(req.body)

  const details = req.body
  const customerId = details["customerid"]
  const price = details["stripe_price"]
  const paymentId = details["paymentid"]

  console.log("here")

  try {

    console.log("here 2")

    const paymentIntent = await stripe.paymentIntents.create({
      amount: price,
      currency: 'gbp',
      customer: customerId,
      payment_method: paymentId,
      off_session: true,
      confirm: true,
    });




    res.json({ clientSecret: paymentIntent })
  } catch (err) {
    // Error code will be authentication_required if authentication is needed
    // res.json({ clientSecret: err })
    res.status(500).json({ error: err.code });
    console.log('Error code is: ', err.code);
  }

})

app.post("/setupSubscription", async (req, res) => {

  console.log(req.body)

  const payments = req.body

  for (let i = 0; i < payments.length; i++) {
    const customerDetails = payments[i]
    const customerId = customerDetails["customerid"]
    const paymentId = customerDetails["paymentid"]
    const paymentType = customerDetails["paymentType"]
    const membership = customerDetails["membership"]
    var subscriptionType = {
      "vip_founder": "price_1NO2luDQ1Xr1pzwr7Y0L8KQi",
      "founder": "price_1NR8Y8DQ1Xr1pzwrEkarkW5V",
      "vip_investor": "price_1NVrPGDQ1Xr1pzwrxtxRKyeA",
      "investor": ""
    }
    // var subscriptionTypeDiscounted = {
    //    "vip_founder" : "",
    //    "founder" : "price_1NT4t7DQ1Xr1pzwr210RuOp0",
    //    "vip_investor" : "",
    //    "investor" : ""
    //  }


    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: 2500,
        currency: 'gbp',
        customer: customerId,
        payment_method: paymentId,
        off_session: true,
        confirm: true,
        // billing_address_collection: 'auto',
        // description: `Curve Club Membership (including tax: ${taxAmount} GBP)`,
      });


      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [
          { price: subscriptionType[membership] },
        ],
        default_payment_method: paymentId,
        automatic_tax: { "enabled": true },
      });




      res.json({ clientSecret: subscription })
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

app.post("/pauseSubscription", async (req, res) => {

  console.log("check", req.body)

  const customer = req.body

  const customerId = customer.id;

  try {
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
    });

    // Send the subscription IDs back to the client
    console.log("subscriptions", subscriptions)
    res.send(subscriptions);
  } catch (error) {
    console.error(error);
    res.status(500).send({ error: 'An error occurred while retrieving the subscriptions.' });
  }

})


app.listen(process.env.PORT || 3000, () => {
  console.log('server started');
});