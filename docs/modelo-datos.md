# Modelo de datos del Sprint #2

## Entidades y campos de pago

`purchases` registra la reserva y conserva `passengerData` como JSON, además de `passengerId`, `departureId`, `classId`, `quantity`, `total`, `status`, `expiresAt` y `releaseReason`.

`payments` registra la transacción: `purchaseId`, `payerPassengerId`, `departureId`, `classId`, `quantity`, `amount`, `reference` (única cuando existe), `status`, `paidAt` y las marcas de tiempo de Sequelize. No se guardan datos de tarjeta.

`tickets` emite los pasajes al confirmar la compra: `purchaseId`, `departureId`, `classId`, `price`, `ticketCode` único (`SIGVA-XXXXXX`) y las marcas de tiempo de Sequelize.

`passengers`, `flights`, `departures` y `classes` son las entidades existentes relacionadas por sus claves foráneas. Cada ticket pertenece a una compra, salida y clase. La persona titular se registra en el pago; los datos de cada pasajero de viaje quedan en `purchases.passengerData`, y se vinculan a cada ticket por el orden de emisión.

## Diagrama entidad-relación

```mermaid
erDiagram
    PASSENGER ||--o{ PURCHASE : realiza
    PURCHASE ||--o{ PAYMENT : registra
    PASSENGER ||--o{ PAYMENT : titular
    DEPARTURE ||--o{ PAYMENT : corresponde
    CLASS ||--o{ PAYMENT : tarifa
    PURCHASE ||--o{ TICKET : emite
    DEPARTURE ||--o{ TICKET : salida
    CLASS ||--o{ TICKET : clase
    FLIGHT ||--o{ DEPARTURE : programa

    PASSENGER {
        int id PK
        int userId FK
        string documentNumber UK
        string email
    }
    PURCHASE {
        int id PK
        int passengerId FK
        int departureId FK
        int classId
        int quantity
        decimal total
        string status
        datetime expiresAt
        string releaseReason
        text passengerData
    }
    PAYMENT {
        int id PK
        int purchaseId FK
        int payerPassengerId FK
        int departureId FK
        int classId FK
        int quantity
        decimal amount
        string reference UK
        string status
        datetime paidAt
    }
    TICKET {
        int id PK
        int purchaseId FK
        int departureId FK
        int classId FK
        decimal price
        string ticketCode UK
    }
    DEPARTURE {
        int id PK
        int flightId FK
        date date
        int soldEconomy
        int soldFirstClass
    }
    FLIGHT {
        int id PK
        string flightNumber UK
        int economySeats
        int firstClassSeats
    }
    CLASS {
        int id PK
        string code UK
        string name
    }
```

## Validación
