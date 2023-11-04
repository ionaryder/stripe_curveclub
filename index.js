// require('dotenv').config({path: './.env'})
const express = require('express')
var cors = require('cors');
const app = express();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY_LIVE);
const { resolve } = require('path')
const bodyParser = require('body-parser')
const SSE = require('express-sse');
const sse = new SSE();


//FIREBASE
const { initializeApp } = require("firebase/app");
const { doc, setDoc, getFirestore, collection, query, where, getDocs, getDoc, updateDoc, serverTimestamp, addDoc } = require("firebase/firestore");
const { Console } = require('console');
require('firebase/compat/auth');
require('firebase/compat/firestore');

const firebaseConfig = {
  apiKey: process.env.firebase_apikey,
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

var claimPassInformation = {}

var currentUser = ""
var eventid = ""

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


const clients = {}; // This holds the SSE connections keyed by a unique client ID

// SSE Setup
app.get('/events', (req, res) => {
  console.log(req)
  const clientId = req.query.clientId; // You'll need to generate and send this from the client
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders(); // Flush the headers to establish SSE with the client

  // Save the SSE connection in your clients object
  clients[clientId] = res;

  // When the client closes the connection, remove it from the clients object
  req.on('close', () => {
    delete clients[clientId];
  });
});

// The part where you send a message to a specific client
const sendToClient = (clientId, data) => {
  console.log("sending to client")
  const client = clients[clientId];
  if (client) {
    console.log("found client", data)
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  }
  else {
    console.log("no client found")
  }
};


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
      // console.log("customer created", applicationInformation)
    case 'checkout.session.completed':
      const session = event.data.object;
      // console.log("checkout session id: ", session)
      

      if (eventid != "" && currentUser != "") {
        signUserUp(eventid, currentUser)
      }
      else if (claimPassInformation != {}) {
        claimThePass(claimPassInformation)
      }

      break;
    case 'payment_method.attached':
      const payment_method = event.data.object;
      console.log("payment_method: ", payment_method.id, payment_method.customer)
      const billingDetails = payment_method.billing_details;

      addStripeDetailsToApplicant(payment_method.id, payment_method.customer, billingDetails.email)
      break;
    case 'payment_intent.succeeded':
      break;
    case 'payment_intent.created':
      const paymentIntent = event.data.object;
      console.log("PaymentIntent Created: ", paymentIntent.id)
      break;
    case 'setup_intent.created' :
      console.log("Setup Intent Created: ", event.data.object)
      
    case 'setup_intent.succeeded':

      const setupIntent = event.data.object;
      console.log("succeeded sui", setupIntent)
      console.log("SetupIntent Created: ", setupIntent.id)
      console.log("Customer: ", setupIntent.customer)
      console.log("Payment Method", setupIntent.payment_method)
      applicationInformation.customer = setupIntent.customer
      // applicationInformation.payment_method = setupIntent.payment_method
      applicationInformation.onboarded = false

      applicationInformation.freeMembership = false
      // console.log("Applicant", applicationInformation)
      
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
        // await setDoc(applicationReference, applicationInformation);
        // applicationInformation = {}
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
      console.log("customer", invoice.customer, "at invoice finalized")
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
      if (invoice_updated.amount_paid == 0 && invoice_updated.status != "void") {
        console.log("getting defaulting customer")
        getDefaultingCustomer(invoice_updated)
          .then((memberId) => {
            console.log("worked", memberId)
          })
          .catch((error) => {
            console.log("catch", error)
          });
      }
      else if (invoice_updated.amount_remaining == 0) {
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

async function addStripeDetailsToApplicant(paymentId, customerId, email) {
  const applicationsCollection = collection(db, 'applications');

  // Create a Firestore query to find the applicant with a matching email
  const q = query(applicationsCollection, where('email', '==', email));

  // Execute the query and get the results
  const querySnapshot = await getDocs(q);

  // Check if the applicants were found
  if (querySnapshot.empty) {
    console.log(`No matching applicants found for email: ${email}`);
    return;
  }

  // Loop through the matching applicants (although there should be only one document for a unique email)
  let updatePromises = [];
  querySnapshot.forEach((doc) => {
    // doc.data() is never undefined for query doc snapshots
    console.log(doc.id, ' => ', doc.data());

    // Prepare the update promise to update the document
    const docRef = doc.ref; // Get a reference to the document
    updatePromises.push(updateDoc(docRef, {
      payment_method: paymentId,
      customer: customerId,
      stripe_complete: true
    }));
  });

  // Execute all the update promises
  try {
    await Promise.all(updatePromises);
    console.log(`Updated applicants with email: ${email}`);
  } catch (error) {
    console.error("Error updating documents: ", error);
  }
}


async function getPaymentIntent(paymentIntentId) {
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent && paymentIntent.payment_method) {
      console.log(`Payment method associated with the PaymentIntent: ${paymentIntent.payment_method}`);
      return paymentIntent.payment_method;
    } else {
      console.log('No payment method associated with the PaymentIntent.');
      return null;
    }

  } catch (error) {
    console.error('Error fetching PaymentIntent:', error);
    return null; // return null in case of error
  }
}

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

async function signUserUp(event, uid) {

  console.log("the event id", event)
  console.log("the uid", uid)

  if (!uid) {
    return;
  }

  const eventRef = doc(db, 'events', event);
  const memberAttendingRef = doc(eventRef, 'membersAttending', uid);

  try {
    await setDoc(memberAttendingRef, {
      timestamp: new Date()
    });

    const membersQuery = query(collection(db, 'members'), where('uid', '==', uid));
    const querySnapshot = await getDocs(membersQuery);

    if (querySnapshot.empty) {
      console.log("Member document not found");
      return;
    }

    const document = querySnapshot.docs[0];
    console.log("member document", document.id);
    const memberRef = doc(db, 'members', document.id);

    const docSnapshot = await getDoc(memberRef);
    const events = docSnapshot.data().events || [];
    events.push(event);

    await updateDoc(memberRef, { events });
    console.log("Member document successfully updated with event id.");
    console.log("Member successfully added to membersAttending collection.");
  } catch (error) {
    console.error("Error:", error);
  }
}

async function claimThePass(info) {
  try {
    console.log("here is the claim pass info", info);

    // Check if info.email is defined before making the query
    if (info.email) {
      // Query the "claim-pass" collection for documents with a matching email
      const claimPassQuery = query(collection(db, "claim_pass"), where("email", "==", info.email));
      const querySnapshot = await getDocs(claimPassQuery);

      if (querySnapshot.docs.length > 0) {
        // If a document with the same email exists, you might want to handle this case.
        // You can either update the existing document or do something else.
        console.log("Document with the same email already exists:", querySnapshot.docs[0].id);
      } else {
        const eventRef = doc(db, "events", info.eventId);
        const prospectivesAttendingRef = collection(eventRef, "prospectivesAttending");

        // Use addDoc to add a new document to the collection
        await addDoc(prospectivesAttendingRef, info);
        console.log("User data added successfully with ID:", prospectivesAttendingRef.id);

        const claimPassRef = collection(db, "claim_pass");

        // Use addDoc to add a new document to the "claim_pass" collection
        await addDoc(claimPassRef, info);
        console.log("User data added successfully to 'claim_pass' with ID:", claimPassRef.id);

        console.log("User data added successfully");
      }
    } else {
      console.log("info.email is not defined. Cannot proceed.");
    }
  } catch (error) {
    console.error("Error adding user data:", error);
    // You can add additional error handling here, such as showing an alert.
  }
}

app.post("/application-checkout", async (req, res) => {

   const applicationReference = doc(collection(db, "applications"));

  console.log("app checkout hit", req.body)
  const request = req.body
  const applicationData = request.data
  const createdAt = applicationData.createdAt
  const date = new Date().toLocaleString()
  // console.log(applicationInformation.data)
  const fields = applicationData.fields
  console.log(fields)


  let result = {};
  let currentValue = null;

  for (let field of fields) {
      if (field.type === 'DROPDOWN' && field.value) {
          // Lookup the text from the options array using the value
          let optionText = field.options.find(option => option.id === field.value[0]).text;
          currentValue = optionText; // Removed array brackets
      } 
      else if (field.type === 'MULTI_SELECT' && field.value) {
          // Lookup the text for each value in the array
          let optionTexts = field.value.map(val => {
              return field.options.find(option => option.id === val).text;
          });
          currentValue = optionTexts; // Kept as an array since it can have multiple values
      } 
        else if (field.label === 'Payment (link)') {

          console.log("here", field.value)

          const url = field.value;
          const regex = /\/(pi_[a-zA-Z0-9]+)(\/|$)/;
          const match = url.match(regex);

          if (match && match[1]) {
            console.log("here 1")
              const paymentIntentFullString = match[1];
              console.log(`PaymentIntent String: ${paymentIntentFullString}`);
              result["payment_intent"] = paymentIntentFullString;
          } else {
            console.log("here 2")
              console.log('PaymentIntent String not found in the provided URL.');
              result["payment_intent"] = "Not found";
          }

        }
      else if (field.type !== 'HIDDEN_FIELDS' && field.value) {
          currentValue = field.value;  // Removed array brackets
      } 
      else if (field.type === 'HIDDEN_FIELDS' && currentValue) { // Modified the check for currentValue
          result[field.label] = currentValue;
          currentValue = null;  // Set to null for clarity 
      }
    
  }


  if (result.membership == "VIP Founder"){
    result.membership = "vip_founder"
  }
  else if (result.membership == "Founder Online & Events"){
      result.membership = "founder"
  } 
  else if (result.membership == "VIP Investor"){
    result.membership = "vip_investor"
  }
  else if (result.membership == "Investor Online & Events"){
    result.membership = "investor"
  }

  result.createdAt = createdAt;
  result.clubhouse = "oldstreet";
  result.approved = false;
  result.freeMembership = false;
  result.stripe_complete = false;
  result.date = date;
  result.paymentMethod = "CARD"
  result.paymentType = "monthly"

  console.log("the result", result);

  try {

    await setDoc(applicationReference, result);

  
    res.send(200);
  } catch (error) {
    console.log(error)
    res.status(400).send({ error });
  }
});


app.post("/add-customer", async (req, res) => {
  console.log("in add-customer", req.body)
  const request = req.body
  const email = request.email

   const customer = await stripe.customers.create({
      email: email // replace with the customer's email
    });

    const customerId = customer.id

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'setup',
      customer: customer.id,
      success_url: "https://www.curve.club/application_submitted",
      cancel_url: "https://www.curve.club/application-page",
    });


    console.log("url", session.url)

    res.json({ url: session.url });
})




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

    claimPassInformation = requestData

    res.json({ url: session.url });
  } catch (error) {
    console.error(error);
    res.status(400).send({ error });
  }
});

app.post("/member_portal_checkout", async (req, res) => {
  const requestData = req.body;

  console.log("app info", requestData);

  let directUrl = `https://www.curveclub.xyz/${requestData.page_url}`;
  let cancelUrl = `https://www.curveclub.xyz/${requestData.page_url}`;

  try {

    // Create a Payment Intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: requestData.stripe_price, // Replace with the amount in cents (e.g., 1000 for $10.00)
      currency: 'gbp', // Replace with your desired currency code
      customer: requestData.customerid,
      payment_method_types: ['card'],
    });

    // Create a Checkout Session using the Payment Intent
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer: requestData.customerid,
      payment_intent_data: {
        setup_future_usage: 'off_session',
      },
      success_url: directUrl,
      cancel_url: cancelUrl,
      line_items: [{
        price: requestData.product_id,
        quantity: 1,
      }],
    });

    eventid = requestData.eventid
    currentUser = requestData.user

    res.json({ url: session.url });
  } catch (error) {
    console.error(error);
    res.status(400).send({ error });
  }
});

app.post("/member_event_checkout", async (req, res) => {
  const requestData = req.body;

  // Use an existing Customer ID if this is a returning customer.
  // const customer = await stripe.customers.create();

  try {

    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: requestData["customerid"] },
      { apiVersion: '2022-08-01' }
    );
    const paymentIntent = await stripe.paymentIntents.create({
      amount: requestData["stripe_price"],
      currency: 'gbp',
      customer: requestData["customerid"],
      // In the latest version of the API, specifying the `automatic_payment_methods` parameter is optional because Stripe enables its functionality by default.
      automatic_payment_methods: {
        enabled: true,
      },
    });

    console.log("Response Data:", {
      paymentIntent: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: requestData["customerid"],
      publishableKey: 'pk_live_51LhavMDQ1Xr1pzwrLA1p3fl5jPRLwSv0Qjlp0MkOp4c1oqeap2OAl1T8Yhp4ZJxRcOTWh7OJzUcb5tYELOuGpP2100CoWFvs0j'
    });

    res.json({
      paymentIntent: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: requestData["customerid"],
      publishableKey: 'pk_live_51LhavMDQ1Xr1pzwrLA1p3fl5jPRLwSv0Qjlp0MkOp4c1oqeap2OAl1T8Yhp4ZJxRcOTWh7OJzUcb5tYELOuGpP2100CoWFvs0j'
    });
  } catch (error) {
    console.error("An error occurred:", error);
    res.status(500).send({ error: "An error occurred" });
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


  const details = req.body
  const customerId = details["customerid"]
  const price = details["stripe_price"]
  const paymentId = details["paymentid"]


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
      "vip_founder": "price_1O7HklDQ1Xr1pzwrWaL9VPaP",
      "founder": "price_1O7HqRDQ1Xr1pzwrqtg3ETtJ",
      "vip_investor": "price_1O7HoyDQ1Xr1pzwrX3uUx42I",
      "investor": "price_1O7Hq0DQ1Xr1pzwrFxtEmjaQ"
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

app.post("/cancelSubscription", async (req, res) => {

  console.log("check", req.body)

  const customer = req.body

  const customerId = customer.id;

  try {
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
    });

    // Send the subscription IDs back to the client
    console.log("subscriptions", subscriptions)

    try {
      console.log("try", subscriptions.data[0].id);

      const subscription = await stripe.subscriptions.update(
        subscriptions.data[0].id,
        {
          "cancel_at_period_end": true,
        }
      );

      console.log("Subscription update successful", subscription);

    } catch (error) {
      console.error("Error in subscription update:", error);
      if (error instanceof Stripe.errors.StripeError) {
        // Handle Stripe errors specifically here
        console.error("Stripe error:", error.message);
        throw new Error(`Stripe error: ${error.message}`);
      } else {
        // Handle other types of errors
        console.error("Non-Stripe error:", error);
        throw new Error(`Error: couldn't cancel subscription. Details: ${error.message}`);
      }
    }

    
    res.status(200).send("Success");
  } catch (error) {
    console.error(error);
    res.status(500).send({ error: 'An error occurred while retrieving the subscriptions.' });
  }

})


app.listen(process.env.PORT || 3000, () => {
  console.log('server started');
});