let data;

setTimeout(() => {
    data = fetchData();
}, 1000);

console.log(data.length); // data er undefined → klassisk async bug
